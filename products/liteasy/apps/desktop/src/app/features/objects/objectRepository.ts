import type { AssetSourceReference } from "../resource-filesystem/assetSourceReferences";
import { objectSourceLineage, type ObjectSourceLineage } from "./objectSourceLineage";
import { structuredBlockSchema, type StructuredBlock, blockPresentationSchema, defaultBlockPresentation, type BlockPresentation, type BlockPresentationRecord } from "./visualBlock.types";
import { hashText } from "../context/objectContext";
import type { StagedObjectAsset } from "./objectAssets";
import {
  objectContentSchema,
  parseObject,
  refOf,
  objectText,
  objectLink,
  isPaperMetadataReference,
  ObjectStoreError,
  type ObjectContent,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
  type ObjectRelation,
  type BoardConnection,
  type BoardSide,
} from "./object.types";
import type { ObjectStorage, StorageChange, StorageRow } from "./objectStorage";

export type ObjectDraft = ObjectContent & {
  sourceReferences?: AssetSourceReference[];
  sourceResolution?: "unavailable";
  paperAnchors?: ObjectEnvelope["paperAnchors"];
  assets?: ObjectEnvelope["assets"];
  title: string;
  sourceRefs?: ObjectRef[];
  derivedFrom?: ObjectRef[];
  runId?: string;
  contextSnapshotId?: string;
};
export type ObjectRepository = ReturnType<typeof createObjectRepository>;
export function createObjectRepository(
  storage: ObjectStorage,
  scopeId: string,
) {
  const id = () => crypto.randomUUID();
  const headKey = (objectId: string) => `head/${objectId}`;
  const revisionKey = (ref: ObjectRef) =>
    `revision/${ref.objectId}/${ref.revision}`;
  const change = (
    key: string,
    value: unknown,
    expected: string | null = null,
  ): StorageChange => ({ key, expected, row: { key, version: id(), value } });
  async function sourceChanges(objectId: string, draft: Pick<ObjectDraft, "sourceReferences" | "sourceResolution">): Promise<StorageChange[]> {
    if (!draft.sourceReferences?.length && !draft.sourceResolution) return [];
    const key = `source-lineage/${objectId}`, previous = await storage.get(key);
    const old = previous?.value as Pick<ObjectDraft, "sourceReferences" | "sourceResolution"> | undefined;
    return [change(key, { sourceReferences: [...new Map([...(old?.sourceReferences ?? []), ...(draft.sourceReferences ?? [])].map((source) => [JSON.stringify(source), source])).values()], sourceResolution: old?.sourceResolution ?? draft.sourceResolution }, previous?.version ?? null)];
  }
  const make = (
    draft: ObjectDraft,
    previous?: ObjectEnvelope,
  ): ObjectEnvelope => {
    const now = new Date().toISOString();
    const object = {
      ...objectContentSchema.parse({
        kind: draft.kind,
        content: draft.content,
      }),
      schemaVersion: "liteasy.object/v1",
      objectId: previous?.objectId ?? id(),
      revision: id(),
      title: draft.title,
      scopeId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      createdBy: previous?.createdBy ?? {
        type: draft.runId ? "agent" : "user",
        id: scopeId,
      },
      assets: draft.assets ?? previous?.assets ?? [],
      ...((draft.paperAnchors ?? previous?.paperAnchors) ? { paperAnchors: draft.paperAnchors ?? previous?.paperAnchors } : {}),
      provenance: {
        sourceRefs: draft.sourceRefs ?? [],
        derivedFrom: draft.derivedFrom,
        runId: draft.runId,
        contextSnapshotId: draft.contextSnapshotId,
      },
      lifecycle: previous?.lifecycle ?? "active",
    };
    return parseObject(object);
  };
  const objectChanges = (object: ObjectEnvelope, head?: StorageRow | null) => {
    const headChange = change(
      headKey(object.objectId),
      object,
      head?.version ?? null,
    );
    // Compact title records avoid loading bodies/attachments during library searches.
    const key = `title/${object.objectId}`;
    return [
      headChange,
      change(revisionKey(refOf(object)), object),
      {
        key,
        expected: head?.version ?? null,
        row: {
          key,
          version: headChange.row!.version,
          value: {
            objectId: object.objectId,
            scopeId,
            title: object.title,
            lifecycle: object.lifecycle,
            kind: object.kind,
            revision: object.revision,
            sourceLineage: objectSourceLineage(object),
            ...(object.kind === "source.document" ? {
              paperId: object.content.payload.paperId,
              ...(object.content.payload.abstractText || isPaperMetadataReference(object) ? { summary: [
                ...(isPaperMetadataReference(object) ? ["题录已固定；正文按需读取。"] : []),
                object.content.payload.abstractText || "摘要尚未提取。",
              ].join("\n").slice(0, 4000) } : {}),
            } : {}),
          },
        },
      },
    ];
  };
  const readObject = (row: StorageRow | null): ObjectEnvelope => {
    if (!row)
      throw new ObjectStoreError(
        "object_not_found",
        "内容在当前账号或设备不可用。",
      );
    const object = parseObject(row.value);
    if (object.scopeId !== scopeId)
      throw new ObjectStoreError(
        "object_not_found",
        "内容在当前账号或设备不可用。",
      );
    return object;
  };
  async function get(ref: ObjectRef) {
    const head = readObject(await storage.get(headKey(ref.objectId)));
    if (head.lifecycle === "tombstoned")
      throw new ObjectStoreError(
        "object_not_found",
        "内容已删除，摘录仍保留原文快照。",
      );
    return readObject(await storage.get(revisionKey(ref)));
  }
  async function resolveLatest(objectId: string) {
    return readObject(await storage.get(headKey(objectId)));
  }
  async function commitOperation(
    key: string,
    parameters: unknown,
    build: () => Promise<{ changes: StorageChange[]; result: ObjectRef[] }>,
  ): Promise<ObjectRef[]> {
    const opKey = `operation/${key}`;
    const fingerprint = await hashText(JSON.stringify(parameters));
    const existing = await storage.get(opKey);
    if (existing) {
      const operation = existing.value as {
        fingerprint: string;
        result: ObjectRef[];
      };
      if (operation.fingerprint !== fingerprint)
        throw new ObjectStoreError(
          "revision_conflict",
          "同一操作标识不能用于不同参数。",
        );
      return operation.result;
    }
    const { changes, result } = await build();
    try {
      await storage.commit([
        ...changes,
        change(opKey, {
          fingerprint,
          result,
          completedAt: new Date().toISOString(),
        }),
      ]);
    } catch (e) {
      const raced = await storage.get(opKey);
      if (raced) {
        const op = raced.value as { fingerprint: string; result: ObjectRef[] };
        if (op.fingerprint === fingerprint) return op.result;
      }
      throw e;
    }
    return result;
  }
  async function create(draft: ObjectDraft, operationId: string = id()) {
    const result = await commitOperation(operationId, draft, async () => {
      for (const ref of draft.sourceRefs ?? []) await get(ref);
      const object = make(draft);
      const changes = objectChanges(object);
      changes.push(...await sourceChanges(object.objectId, draft));
      for (const source of draft.derivedFrom ?? []) {
        await get(source);
        const relation: ObjectRelation = {
          relationId: id(),
          revision: id(),
          from: refOf(object),
          to: source,
          predicate: "derived_from",
          scopeId,
          assertedBy: object.createdBy,
          createdAt: object.createdAt,
          basis: { type: "operation", reason: "制作独立副本" },
          reviewStatus: "accepted",
        };
        changes.push(
          change(
            `relation/derived_from/${object.objectId}/${source.objectId}`,
            relation,
          ),
        );
      }
      return { changes, result: [refOf(object)] };
    });
    return get(result[0]);
  }
  const placement = (
    boardId: string,
    ref: ObjectRef,
    index = 0,
  ): Placement => ({
    placementId: id(),
    revision: id(),
    boardId,
    ref,
    position: { x: (index % 3) * 290, y: Math.floor(index / 3) * 220 },
    size: { width: 270, height: 200 },
    collapsed: false,
    viewId: "card",
  });
  const membershipKey = (boardId: string, objectId: string) =>
    `relation/member_of/${boardId}/${objectId}`;
  const membership = (
    board: ObjectEnvelope,
    ref: ObjectRef,
  ): ObjectRelation => ({
    relationId: id(),
    revision: id(),
    from: ref,
    to: refOf(board),
    predicate: "member_of",
    scopeId,
    assertedBy: { type: "user", id: scopeId },
    createdAt: new Date().toISOString(),
    basis: { type: "operation", reason: "加入白板" },
    reviewStatus: "accepted",
  });
  async function getBlockPresentation(boardId: string, placementId = "$board"): Promise<BlockPresentationRecord> {
    const board = await resolveLatest(boardId);
    if (board.kind !== "workspace.board") throw new ObjectStoreError("capability_denied", "该资源不是白板。");
    const row = await storage.get(`block-presentation/${boardId}/${placementId}`);
    return { version: row?.version ?? null, value: row ? blockPresentationSchema.parse(row.value) : defaultBlockPresentation };
  }
  async function setBlockPresentation(input: {
    boardRef: ObjectRef; placementId?: string; expectedVersion: string | null;
    value: BlockPresentation; operationId: string;
  }) {
    const value = blockPresentationSchema.parse(input.value);
    return commitOperation(input.operationId, input, async () => {
      const head = await storage.get(headKey(input.boardRef.objectId));
      const board = readObject(head);
      if (board.kind !== "workspace.board" || board.lifecycle !== "active") throw new ObjectStoreError("capability_denied", "白板不可编辑。");
      if (board.revision !== input.boardRef.revision) throw new ObjectStoreError("revision_conflict", "白板已变化，请刷新后重试。");
      if (input.placementId && !(await listPlacements(board.objectId)).some((p) => p.placementId === input.placementId)) throw new ObjectStoreError("object_not_found", "卡片已移除。");
      const key = `block-presentation/${board.objectId}/${input.placementId ?? "$board"}`;
      const row = await storage.get(key);
      if ((row?.version ?? null) !== input.expectedVersion) throw new ObjectStoreError("revision_conflict", "卡片显示设置已变化，请重新打开设置。");
      if (row) blockPresentationSchema.parse(row.value); // Never overwrite unknown newer formats.
      const next = make({ ...board, sourceRefs: board.provenance.sourceRefs }, board);
      const layers: StorageChange[] = [];
      if (value.layer === 10000) {
        for (const item of await storage.list(`block-presentation/${board.objectId}/`, "", 1000)) {
          if (item.key === key) continue;
          const previous = blockPresentationSchema.safeParse(item.value);
          if (previous.success && previous.data.layer === 10000) layers.push(change(item.key, { ...previous.data, layer: 9999 }, item.version));
        }
      }
      return { changes: [...objectChanges(next, head), ...layers, change(key, value, input.expectedVersion)], result: [refOf(next)] };
    });
  }
  async function checkLayoutUnlocked(boardId: string, placementId: string) {
    const [board, block] = await Promise.all([getBlockPresentation(boardId), getBlockPresentation(boardId, placementId)]);
    if (block.value.locked ?? board.value.locked) throw new ObjectStoreError("capability_denied", "卡片布局已锁定，请先解锁。");
  }
  type Geometry = { placementId: string; position: Placement["position"]; size: Placement["size"] };
  type LayoutEdit = { before: Geometry[]; after: Geometry[] };
  type LayoutHistory = { schema: "liteasy.board-layout-history/v1"; undo: LayoutEdit[]; redo: LayoutEdit[] };
  async function layoutHistory(boardId: string) {
    const key = `board-layout-history/${boardId}`, row = await storage.get(key);
    const value = row?.value as LayoutHistory | undefined;
    if (value && value.schema !== "liteasy.board-layout-history/v1") throw new Error("此布局历史来自更新版本，已保留。");
    return { key, row, value: value ?? { schema: "liteasy.board-layout-history/v1" as const, undo: [], redo: [] } };
  }
  async function restoreBoardLayout(boardRef: ObjectRef, direction: "undo" | "redo", operationId: string) {
    return commitOperation(operationId, { boardRef, direction }, async () => {
      const head = await storage.get(headKey(boardRef.objectId)), board = readObject(head);
      if (board.revision !== boardRef.revision) throw new ObjectStoreError("revision_conflict", "白板已变化。");
      const history = await layoutHistory(board.objectId), edit = history.value[direction].at(-1);
      if (!edit) throw new Error(direction === "undo" ? "没有可撤销的布局调整。" : "没有可重做的布局调整。");
      const expected = direction === "undo" ? edit.after : edit.before, target = direction === "undo" ? edit.before : edit.after;
      const changes: StorageChange[] = [];
      for (const item of target) {
        await checkLayoutUnlocked(board.objectId, item.placementId);
        const key = `placement/${board.objectId}/${item.placementId}`, row = await storage.get(key), current = row?.value as Placement | undefined;
        const previous = expected.find((entry) => entry.placementId === item.placementId)!;
        if (!current || JSON.stringify(current.position) !== JSON.stringify(previous.position) || JSON.stringify(current.size) !== JSON.stringify(previous.size)) throw new ObjectStoreError("revision_conflict", "卡片已被另一次编辑调整，无法覆盖后续布局。");
        changes.push(change(key, { ...current, position: item.position, size: item.size, revision: id() }, row!.version));
      }
      const opposite = direction === "undo" ? "redo" : "undo";
      changes.push(change(history.key, { ...history.value, [direction]: history.value[direction].slice(0, -1), [opposite]: [...history.value[opposite], edit].slice(-32) }, history.row?.version ?? null));
      const next = make({ ...board, sourceRefs: board.provenance.sourceRefs }, board);
      return { changes: [...changes, ...objectChanges(next, head)], result: [refOf(next)] };
    });
  }
  async function applyBoardPatch(input: {
    boardRef: ObjectRef;
    operationId: string;
    add?: ObjectRef[];
    remove?: string[];
    move?: Array<{
      placementId: string;
      revision: string;
      position: Placement["position"];
    }>;
    resize?: Array<{
      placementId: string;
      revision: string;
      position: Placement["position"];
      size: Placement["size"];
    }>;
  }) {
    return commitOperation(
      input.operationId,
      { ...input, boardRef: input.boardRef?.objectId },
      async () => {
        const head = await storage.get(headKey(input.boardRef.objectId));
        const board = readObject(head);
        if (board.revision !== input.boardRef.revision)
          throw new ObjectStoreError(
            "revision_conflict",
            "白板已变化，请刷新后重试。",
          );
        if (board.kind !== "workspace.board" || board.lifecycle !== "active")
          throw new ObjectStoreError(
            "capability_denied",
            "该内容不能作为白板编辑。",
          );
        const current = await listPlacements(board.objectId);
        const changes: StorageChange[] = [];
        for (const ref of input.add ?? []) {
          await get(ref);
          const p = placement(
            board.objectId,
            ref,
            current.length + changes.length,
          );
          changes.push(
            change(`placement/${board.objectId}/${p.placementId}`, p),
          );
        }
        for (const placementId of input.remove ?? []) {
          const key = `placement/${board.objectId}/${placementId}`;
          const row = await storage.get(key);
          if (!row)
            throw new ObjectStoreError("revision_conflict", "卡片已移除。");
          changes.push({ key, expected: row.version, row: null });
        }
        if (input.remove?.length) {
          for (const row of await storage.list(
            `edge/${board.objectId}/`,
            "",
            1000,
          )) {
            const edge = row.value as BoardConnection;
            if (
              !input.remove.includes(edge.from) &&
              !input.remove.includes(edge.to)
            )
              continue;
            changes.push({ key: row.key, expected: row.version, row: null });
            const relationKey = `relation/board-link/${board.objectId}/${edge.edgeId}`;
            const relation = await storage.get(relationKey);
            if (relation)
              changes.push({
                key: relationKey,
                expected: relation.version,
                row: null,
              });
          }
        }
        for (const move of input.move ?? []) {
          await checkLayoutUnlocked(board.objectId, move.placementId);
          const key = `placement/${board.objectId}/${move.placementId}`;
          const row = await storage.get(key);
          const p = row?.value as Placement | undefined;
          if (!p || p.revision !== move.revision)
            throw new ObjectStoreError("revision_conflict", "卡片位置已变化。");
          changes.push(
            change(
              key,
              { ...p, position: move.position, revision: id() },
              row!.version,
            ),
          );
        }
        for (const resize of input.resize ?? []) {
          await checkLayoutUnlocked(board.objectId, resize.placementId);
          const key = `placement/${board.objectId}/${resize.placementId}`;
          const row = await storage.get(key);
          const p = row?.value as Placement | undefined;
          if (!p || p.revision !== resize.revision)
            throw new ObjectStoreError(
              "revision_conflict",
              "卡片大小已变化，请刷新后重试。",
            );
          if (
            ![
              resize.position.x,
              resize.position.y,
              resize.size.width,
              resize.size.height,
            ].every(Number.isFinite) ||
            resize.position.x < 0 ||
            resize.position.y < 0 ||
            resize.size.width < 120 ||
            resize.size.height < 80
          )
            throw new ObjectStoreError(
              "capability_denied",
              "卡片大小或位置无效。",
            );
          changes.push(
            change(
              key,
              {
                ...p,
                position: resize.position,
                size: resize.size,
                revision: id(),
              },
              row!.version,
            ),
          );
        }
        const next = make(
          { ...board, sourceRefs: board.provenance.sourceRefs },
          board,
        );
        const remaining = new Map(
          current
            .filter((p) => !input.remove?.includes(p.placementId))
            .map((p) => [p.ref.objectId, p.ref]),
        );
        for (const ref of input.add ?? []) remaining.set(ref.objectId, ref);
        const affected = new Set([
          ...(input.add ?? []).map((ref) => ref.objectId),
          ...current
            .filter((p) => input.remove?.includes(p.placementId))
            .map((p) => p.ref.objectId),
        ]);
        for (const objectId of affected) {
          const key = membershipKey(board.objectId, objectId);
          const row = await storage.get(key);
          const ref = remaining.get(objectId);
          if (!ref && row)
            changes.push({ key, expected: row.version, row: null });
          else if (
            ref &&
            (!row ||
              JSON.stringify((row.value as ObjectRelation).from) !==
                JSON.stringify(ref))
          )
            changes.push(
              change(key, membership(next, ref), row?.version ?? null),
            );
        }
        const adjusted = changes.filter((item) => item.row && item.key.startsWith(`placement/${board.objectId}/`) && current.some((p) => p.placementId === (item.row!.value as Placement).placementId));
        if (adjusted.length) {
          const geometry = (p: Placement): Geometry => ({ placementId: p.placementId, position: p.position, size: p.size });
          const history = await layoutHistory(board.objectId);
          const edit = { before: adjusted.map((item) => geometry(current.find((p) => p.placementId === (item.row!.value as Placement).placementId)!)), after: adjusted.map((item) => geometry(item.row!.value as Placement)) };
          changes.push(change(history.key, { schema: "liteasy.board-layout-history/v1", undo: [...history.value.undo, edit].slice(-32), redo: [] }, history.row?.version ?? null));
        }
        return {
          changes: [...changes, ...objectChanges(next, head)],
          result: [refOf(next)],
        };
      },
    );
  }
  async function listPlacements(boardId: string) {
    await resolveLatest(boardId);
    return (await storage.list(`placement/${boardId}/`, "", 1000)).map(
      (row) => row.value as Placement,
    );
  }
  async function captureObject(input: {
    position?: Placement["position"];
    draft: ObjectDraft;
    assets?: StagedObjectAsset[];
    boardRef?: ObjectRef;
    operationId: string;
    legacyKey?: string;
  }) {
    return commitOperation(
      input.operationId,
      { ...input, boardRef: input.boardRef?.objectId },
      async () => {
        if (input.draft.kind === "content.fragment")
          for (const anchor of input.draft.content.payload.anchors)
            await get(anchor.sourceRef);
        for (const source of input.draft.sourceRefs ?? []) await get(source);
        const mapping = input.legacyKey
          ? await storage.get(`legacy/${input.legacyKey}`)
          : null;
        const mappedRef = mapping?.value as ObjectRef | undefined;
        const mappedHead = mappedRef
          ? await storage.get(headKey(mappedRef.objectId))
          : null;
        const previous = mappedHead ? readObject(mappedHead) : undefined;
        if (previous?.lifecycle === "tombstoned")
          throw new ObjectStoreError("object_not_found", "该批注内容已删除。");
        const candidate = make(input.draft, previous);
        const unchanged =
          previous &&
          previous.title === candidate.title &&
          JSON.stringify(previous.content) ===
            JSON.stringify(candidate.content) &&
          JSON.stringify(previous.assets) === JSON.stringify(candidate.assets) &&
          JSON.stringify(previous.paperAnchors) === JSON.stringify(candidate.paperAnchors);
        const object = unchanged ? previous : candidate;
        const changes = unchanged ? [] : objectChanges(object, mappedHead);
        if (input.legacyKey && !unchanged)
          changes.push(
            change(
              `legacy/${input.legacyKey}`,
              refOf(object),
              mapping?.version ?? null,
            ),
          );
        for (const asset of new Map(
          (input.assets ?? []).map((asset) => [asset.assetId, asset]),
        ).values())
          if (!(await storage.get(`asset/${asset.assetId}`)))
            changes.push(change(`asset/${asset.assetId}`, asset));
        if (input.boardRef) {
          const head = await storage.get(headKey(input.boardRef.objectId));
          const board = readObject(head);
          if (
            board.kind !== "workspace.board" ||
            board.lifecycle !== "active" ||
            board.revision !== input.boardRef.revision
          )
            throw new ObjectStoreError(
              "revision_conflict",
              "白板已变化，请刷新后重试。",
            );
          const p = placement(
            board.objectId,
            refOf(object),
            (await listPlacements(board.objectId)).length,
          );
          if (input.position) {
            if (![input.position.x, input.position.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0))
              throw new ObjectStoreError("unsupported_schema", "卡片位置无效。");
            p.position = input.position;
          }
          const memberKey = membershipKey(board.objectId, object.objectId);
          const member = await storage.get(memberKey);
          changes.push(
            change(`placement/${board.objectId}/${p.placementId}`, p),
            change(
              memberKey,
              membership(board, refOf(object)),
              member?.version ?? null,
            ),
            ...objectChanges(
              make(
                { ...board, sourceRefs: board.provenance.sourceRefs },
                board,
              ),
              head,
            ),
          );
        }
        return { changes, result: [refOf(object)] };
      },
    );
  }
  async function relate(
    from: ObjectRef,
    to: ObjectRef,
    predicate: "references" | "related_to",
    reason = "用户建立关联",
  ) {
    await get(from);
    await get(to);
    if (predicate === "related_to" && JSON.stringify(from) > JSON.stringify(to))
      [from, to] = [to, from];
    const key = `relation/${predicate}/${from.objectId}/${from.revision}/${to.objectId}/${to.revision}`;
    const existing = await storage.get(key);
    if (existing) return existing.value as ObjectRelation;
    const relation: ObjectRelation = {
      relationId: id(),
      revision: id(),
      from,
      to,
      predicate,
      scopeId,
      assertedBy: { type: "user", id: scopeId },
      createdAt: new Date().toISOString(),
      basis: { type: "user_judgment", reason },
      reviewStatus: "accepted",
    };
    await storage.commit([change(key, relation)]);
    return relation;
  }
  async function listRelations(
    ref: ObjectRef,
    filter?: {
      predicate?: ObjectRelation["predicate"];
      direction?: "outgoing" | "incoming";
    },
  ) {
    await get(ref);
    const rows: StorageRow[] = [];
    let cursor = "";
    do {
      const page = await storage.list("relation/", cursor, 1000);
      rows.push(...page);
      cursor = page.length === 1000 ? page[page.length - 1].key : "";
    } while (cursor);
    return rows
      .map((row) => row.value as ObjectRelation)
      .filter(
        (r) =>
          (!filter?.predicate || r.predicate === filter.predicate) &&
          ((filter?.direction !== "incoming" &&
            r.from.objectId === ref.objectId &&
            (r.from.revision === ref.revision ||
              r.predicate === "member_of")) ||
            (filter?.direction !== "outgoing" &&
              r.to.objectId === ref.objectId &&
              (r.to.revision === ref.revision || r.predicate === "member_of"))),
      );
  }
  async function searchTitles(query = "", limit = 20) {
    const results: Array<{ objectId: string; title: string; kind?: ObjectEnvelope["kind"]; revision?: string; paperId?: string; summary?: string }> = [];
    const normalized = query.toLocaleLowerCase();
    let after = "";
    do {
      const rows = await storage.list("title/", after, 1000);
      for (const row of rows) {
        after = row.key;
        const entry = row.value as { objectId: string; title: string; lifecycle: string; kind?: ObjectEnvelope["kind"]; revision?: string; paperId?: string; summary?: string };
        if (entry.lifecycle === "active" && `${entry.title} ${entry.objectId}`.toLocaleLowerCase().includes(normalized)) {
          results.push({ objectId: entry.objectId, title: entry.title, ...(entry.kind ? { kind: entry.kind } : {}), ...(entry.revision ? { revision: entry.revision } : {}),
            ...(entry.paperId ? { paperId: entry.paperId } : {}), ...(entry.summary ? { summary: entry.summary } : {}) });
          if (results.length >= limit) return results;
        }
      }
      if (rows.length < 1000) break;
    } while (after);
    return results;
  }
  async function search(query = "", cursor = "", excluded?: ReadonlySet<string>) {
    const objects: ObjectEnvelope[] = [];
    const normalized = query.toLocaleLowerCase();
    let after = cursor;
    do {
      const rows = await storage.list("title/", after, normalized ? 1000 : 100);
      for (const row of rows) {
        const entry = row.value as {
          objectId: string;
          title: string;
          lifecycle: string;
        };
        after = row.key;
        if (
          entry.lifecycle !== "active" || excluded?.has(entry.objectId) ||
          !entry.title.toLocaleLowerCase().includes(normalized)
        )
          continue;
        try {
          const object = readObject(await storage.get(headKey(entry.objectId)));
          if (object.lifecycle === "active") objects.push(object);
        } catch (error) {
          if (
            !(error instanceof ObjectStoreError) ||
            error.code !== "unsupported_schema"
          )
            throw error;
        }
        if (objects.length === 100)
          return { objects, cursor: after as string | undefined };
      }
      if (rows.length < (normalized ? 1000 : 100)) break;
    } while (after);
    return { objects, cursor: undefined as string | undefined };
  }
  async function editNote(ref: ObjectRef, text: string, title?: string, sourceRefs: ObjectRef[] = []) {
    if (await storage.get(`visual-block/${ref.objectId}/${ref.revision}`)) throw new ObjectStoreError("capability_denied", "此卡片包含结构化字段，请用组件编辑器或 liteasy_block_update 保存；普通笔记写入不会破坏其类型。");
    const head = await storage.get(headKey(ref.objectId));
    const current = readObject(head);
    if (current.revision !== ref.revision)
      throw new ObjectStoreError(
        "revision_conflict",
        "笔记已变化，请刷新后重试。",
      );
    if (current.kind !== "content.note")
      throw new ObjectStoreError(
        "capability_denied",
        "论文原文、原图和摘录为只读，请制作独立副本。",
      );
    const next = make(
      {
        ...current,
        title: title ?? current.title,
        content: {
          schema: "liteasy.note/v1",
          payload: { ...current.content.payload, text },
        },
        ...current.provenance,
        sourceRefs: [...current.provenance.sourceRefs, ...sourceRefs],
      },
      current,
    );
    await storage.commit(objectChanges(next, head));
    return next;
  }
  async function copy(ref: ObjectRef, operationId?: string) {
    const source = await get(ref);
    const object = await create(
      {
        title: `${source.title}（副本）`,
        kind: "content.note",
        assets: source.assets,
        paperAnchors: source.paperAnchors,
        content: {
          schema: "liteasy.note/v1",
          payload: {
            text: objectText(source),
            origin: "derived",
            assetIds: source.assets.map((asset) => asset.assetId),
          },
        },
        sourceRefs: [ref],
        derivedFrom: [ref],
      },
      operationId,
    );
    return object;
  }
  async function editPlacement(input: {
    boardRef: ObjectRef;
    placement: Placement;
    structured?: StructuredBlock;
    text: string;
    operationId: string;
  }) {
    return commitOperation(input.operationId, input, async () => {
      const boardHead = await storage.get(headKey(input.boardRef.objectId));
      const board = readObject(boardHead);
      const key = `placement/${board.objectId}/${input.placement.placementId}`;
      const row = await storage.get(key);
      const p = row?.value as Placement | undefined;
      if (
        board.kind !== "workspace.board" ||
        board.lifecycle !== "active" ||
        board.revision !== input.boardRef.revision ||
        !p ||
        p.revision !== input.placement.revision
      )
        throw new ObjectStoreError(
          "revision_conflict",
          "卡片已变化，请刷新后重试。",
        );
      const source = await get(p.ref);
      if (source.kind !== "content.note" && source.kind !== "content.fragment")
        throw new ObjectStoreError(
          "capability_denied",
          "此内容不支持直接编辑。",
        );
      const sourceHead = await storage.get(headKey(source.objectId));
      if (
        source.kind === "content.note" &&
        readObject(sourceHead).revision !== source.revision
      )
        throw new ObjectStoreError(
          "revision_conflict",
          "笔记已有更新，请打开最新版本后编辑。",
        );
      const draft: ObjectDraft =
        source.kind === "content.note"
          ? {
              ...source,
              ...source.provenance,
              title: input.text.slice(0, 80) || "笔记",
              content: {
                schema: "liteasy.note/v1",
                payload: { ...source.content.payload, text: input.text },
              },
            }
          : {
              kind: "content.note",
              title: input.text.slice(0, 80) || "笔记",
              assets: source.assets,
              paperAnchors: source.paperAnchors,
              sourceRefs: [p.ref],
              derivedFrom: [p.ref],
              content: {
                schema: "liteasy.note/v1",
                payload: {
                  text: input.text,
                  origin: "derived",
                  assetIds: source.assets.map((asset) => asset.assetId),
                },
              },
            };
      const next = make(
        draft,
        source.kind === "content.note" ? source : undefined,
      );
      const nextBoard = make({ ...board, ...board.provenance }, board);
      const changes = [
        ...objectChanges(
          next,
          source.kind === "content.note" ? sourceHead : null,
        ),
        ...objectChanges(nextBoard, boardHead),
        change(key, { ...p, ref: refOf(next), revision: id() }, row!.version),
      ];
      if (input.structured) changes.push(change(`visual-block/${next.objectId}/${next.revision}`, structuredBlockSchema.parse(input.structured)));
      const memberKey = membershipKey(board.objectId, next.objectId);
      const member = await storage.get(memberKey);
      changes.push(
        change(
          memberKey,
          membership(nextBoard, refOf(next)),
          member?.version ?? null,
        ),
      );
      for (const edgeRow of await storage.list(
        `edge/${board.objectId}/`,
        "",
        1000,
      )) {
        const edge = edgeRow.value as BoardConnection;
        if (edge.from !== p.placementId && edge.to !== p.placementId) continue;
        const key = `relation/board-link/${board.objectId}/${edge.edgeId}`;
        const row = await storage.get(key);
        if (!row) continue;
        const relation = row.value as ObjectRelation;
        changes.push(
          change(
            key,
            {
              ...relation,
              revision: id(),
              from: edge.from === p.placementId ? refOf(next) : relation.from,
              to: edge.to === p.placementId ? refOf(next) : relation.to,
            },
            row.version,
          ),
        );
      }
      if (source.kind === "content.fragment") {
        const relation: ObjectRelation = {
          relationId: id(),
          revision: id(),
          from: refOf(next),
          to: p.ref,
          predicate: "derived_from",
          scopeId,
          assertedBy: { type: "user", id: scopeId },
          createdAt: next.createdAt,
          basis: { type: "operation", reason: "从摘录编辑为笔记" },
          reviewStatus: "accepted",
        };
        changes.push(
          change(
            `relation/derived_from/${next.objectId}/${source.objectId}`,
            relation,
          ),
        );
        const others = (await listPlacements(board.objectId)).filter(
          (candidate) =>
            candidate.placementId !== p.placementId &&
            candidate.ref.objectId === source.objectId,
        );
        if (!others.length) {
          const oldKey = membershipKey(board.objectId, source.objectId);
          const old = await storage.get(oldKey);
          if (old)
            changes.push({ key: oldKey, expected: old.version, row: null });
        }
      }
      return { changes, result: [refOf(next)] };
    });
  }
  async function migrateBoard(input: {
    key: string;
    snapshot: unknown;
    title: string;
    paperId: string;
    assets?: StagedObjectAsset[];
    nodes: Array<{
      legacyId: string;
      draft: ObjectDraft;
      position: Placement["position"];
      size: Placement["size"];
    }>;
    edges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      kind: string;
      label?: string;
    }>;
  }) {
    const journalKey = `migration/${input.key}`;
    const journal = await storage.get(journalKey);
    if (journal)
      return resolveLatest((journal.value as { boardId: string }).boardId);
    const result = await commitOperation(
      `migration-${input.key}`,
      { key: input.key },
      async () => {
        const board = make({
          kind: "workspace.board",
          title: input.title,
          content: {
            schema: "liteasy.board/v1",
            payload: { description: "", paperId: input.paperId },
          },
        });
        const changes = objectChanges(board);
        for (const asset of input.assets ?? [])
          if (!(await storage.get(`asset/${asset.assetId}`)))
            changes.push(change(`asset/${asset.assetId}`, asset));
        const ids = new Map<string, string>();
        for (const node of input.nodes) {
          const object = make(node.draft);
          const p = {
            ...placement(board.objectId, refOf(object)),
            position: node.position,
            size: node.size,
          };
          ids.set(node.legacyId, p.placementId);
          changes.push(
            ...objectChanges(object),
            change(`placement/${board.objectId}/${p.placementId}`, p),
            change(
              membershipKey(board.objectId, object.objectId),
              membership(board, refOf(object)),
            ),
          );
        }
        for (const edge of input.edges) {
          const from = ids.get(edge.sourceNodeId),
            to = ids.get(edge.targetNodeId);
          if (!from || !to)
            throw new ObjectStoreError(
              "persistence_failed",
              "旧白板包含失效连线，原快照已保留。",
            );
          changes.push(
            change(`edge/${board.objectId}/${edge.id}`, {
              edgeId: edge.id,
              from,
              to,
              kind: edge.kind,
              label: edge.label,
            }),
          );
        }
        changes.push(
          change(journalKey, {
            boardId: board.objectId,
            snapshot: input.snapshot,
            migratedAt: new Date().toISOString(),
            nodes: input.nodes.length,
            edges: input.edges.length,
          }),
        );
        return { changes, result: [refOf(board)] };
      },
    );
    return get(result[0]);
  }
  return {
    scopeId,
    getBlockPresentation,
    setBlockPresentation,
    async getAttachmentBase(objectId: string): Promise<{ mountId: string; path: string } | undefined> { await resolveLatest(objectId); return (await storage.get(`object-attachment/${objectId}`))?.value as { mountId: string; path: string } | undefined; },
    async getStructuredBlock(ref: ObjectRef): Promise<StructuredBlock | undefined> {
      await get(ref);
      const row = await storage.get(`visual-block/${ref.objectId}/${ref.revision}`);
      return row ? structuredBlockSchema.parse(row.value) : undefined;
    },
    async createStructuredBlock(input: { title: string; text: string; block: StructuredBlock; boardRef?: ObjectRef; position?: Placement["position"]; operationId: string }) {
      const block = structuredBlockSchema.parse(input.block);
      const result = await commitOperation(input.operationId, input, async () => {
        const object = make({ title: input.title, kind: "content.note", content: { schema: "liteasy.note/v1", payload: { text: input.text, origin: "user" } } });
        const changes = [...objectChanges(object), change(`visual-block/${object.objectId}/${object.revision}`, block), change(`visual-block-type/${object.objectId}`, block.type)];
        if (input.boardRef) {
          const head = await storage.get(headKey(input.boardRef.objectId));
          const board = readObject(head);
          if (board.kind !== "workspace.board" || board.lifecycle !== "active" || board.revision !== input.boardRef.revision) throw new ObjectStoreError("revision_conflict", "白板已变化。");
          const next = make({ ...board, sourceRefs: board.provenance.sourceRefs }, board);
          const p = placement(board.objectId, refOf(object), (await listPlacements(board.objectId)).length);
          if (input.position) p.position = input.position;
          changes.push(...objectChanges(next, head), change(`placement/${board.objectId}/${p.placementId}`, p), change(membershipKey(board.objectId, object.objectId), membership(next, refOf(object))));
        }
        return { changes, result: [refOf(object)] };
      });
      return get(result[0]);
    },
    async updateStructuredBlock(input: { ref: ObjectRef; title: string; text: string; block: StructuredBlock; operationId: string }) {
      const block = structuredBlockSchema.parse(input.block);
      const result = await commitOperation(input.operationId, input, async () => {
        const head = await storage.get(headKey(input.ref.objectId));
        const previous = readObject(head);
        if (previous.kind !== "content.note" || previous.lifecycle !== "active" || previous.revision !== input.ref.revision) throw new ObjectStoreError("revision_conflict", "内容已变化。");
        const next = make({ ...previous, title: input.title, sourceRefs: previous.provenance.sourceRefs, content: { schema: "liteasy.note/v1", payload: { ...previous.content.payload, text: input.text } } }, previous);
        // Advance live placements to the new content revision; geometry and style are untouched.
        const changes: StorageChange[] = [...objectChanges(next, head), change(`visual-block/${next.objectId}/${next.revision}`, block), change(`visual-block-type/${next.objectId}`, block.type, (await storage.get(`visual-block-type/${next.objectId}`))?.version ?? null)];
        const affectedBoards = new Set<string>();
        let cursor = "";
        do {
          const rows = await storage.list("placement/", cursor, 200);
          for (const row of rows) {
            const p = row.value as Placement;
            if (p.ref.objectId === previous.objectId && p.ref.revision === previous.revision) {
              changes.push(change(row.key, { ...p, ref: refOf(next), revision: id() }, row.version));
              affectedBoards.add(p.boardId);
            }
          }
          if (rows.length < 200) break;
          cursor = rows.at(-1)!.key;
        } while (cursor);
        for (const boardId of affectedBoards) {
          const boardHead = await storage.get(headKey(boardId)), board = readObject(boardHead);
          if (board.kind !== "workspace.board" || board.lifecycle !== "active") continue;
          const updated = make({ ...board, sourceRefs: board.provenance.sourceRefs }, board);
          const memberKey = membershipKey(boardId, next.objectId), member = await storage.get(memberKey);
          changes.push(...objectChanges(updated, boardHead), change(memberKey, membership(updated, refOf(next)), member?.version ?? null));
        }
        return { changes, result: [refOf(next)] };
      });
      return get(result[0]);
    },
    async groupPlacements(boardRef: ObjectRef, selected: string[], operationId: string) {
      return commitOperation(operationId, { boardRef, selected }, async () => {
        const head = await storage.get(headKey(boardRef.objectId)), board = readObject(head);
        if (board.kind !== "workspace.board" || board.lifecycle !== "active" || board.revision !== boardRef.revision) throw new ObjectStoreError("revision_conflict", "白板已变化。");
        const items = (await listPlacements(board.objectId)).filter((item) => selected.includes(item.placementId));
        if (!items.length || items.length > 100 || items.length !== selected.length) throw new Error("请选择 1 至 100 张有效卡片。");
        for (const item of items) await checkLayoutUnlocked(board.objectId, item.placementId);
        const sources = await Promise.all(items.map((item) => get(item.ref)));
        const object = make({ kind: "content.note", title: "分组", sourceRefs: items.map((item) => item.ref), content: { schema: "liteasy.note/v1", payload: { text: sources.map((source) => `[${source.title.replace(/[\[\]]/g, "")}](${objectLink(refOf(source))}&scope=${encodeURIComponent(scopeId)})`).join("\n\n"), origin: "user" } } });
        const p = placement(board.objectId, refOf(object), 0);
        p.position = { x: Math.max(0, Math.min(...items.map((item) => item.position.x)) - 24), y: Math.max(0, Math.min(...items.map((item) => item.position.y)) - 48) };
        p.size = { width: Math.max(...items.map((item) => item.position.x + item.size.width)) - p.position.x + 24, height: Math.max(...items.map((item) => item.position.y + item.size.height)) - p.position.y + 24 };
        const changes = [...objectChanges(object), change(`placement/${board.objectId}/${p.placementId}`, p), change(membershipKey(board.objectId, object.objectId), membership(board, refOf(object))), change(`block-presentation/${board.objectId}/${p.placementId}`, { ...defaultBlockPresentation, group: true, layer: 0 })];
        for (const item of items) { const style = await getBlockPresentation(board.objectId, item.placementId); changes.push(change(`block-presentation/${board.objectId}/${item.placementId}`, { ...style.value, groupId: p.placementId }, style.version)); }
        const next = make({ ...board, sourceRefs: board.provenance.sourceRefs }, board);
        return { changes: [...changes, ...objectChanges(next, head)], result: [refOf(next)] };
      });
    },
    /** Lightweight current-head metadata; old indexes safely fall back to their existing object. */
    async describeObject(objectId: string) {
      const row = await storage.get(`title/${objectId}`);
      const indexed = row?.value as { scopeId?: string; objectId: string; title: string; lifecycle: string; kind?: ObjectEnvelope["kind"]; revision?: string; paperId?: string; summary?: string; sourceLineage?: ObjectSourceLineage } | undefined;
      const object = !indexed?.kind || !indexed.revision || !indexed.sourceLineage || indexed.scopeId !== scopeId ? await resolveLatest(objectId) : undefined;
      const description = object ? { objectId: object.objectId, title: object.title, kind: object.kind, revision: object.revision, lifecycle: object.lifecycle, sourceLineage: objectSourceLineage(object),
        ...(object.kind === "source.document" ? { paperId: object.content.payload.paperId, summary: object.content.payload.abstractText?.slice(0, 4000) } : {}) }
        : { ...indexed!, kind: indexed!.kind!, revision: indexed!.revision! };
      if (description.lifecycle !== "active") throw new ObjectStoreError("object_not_found", "内容已归档或删除。");
      const binding = description.kind === "content.note" ? await storage.get(`object-file/${objectId}`)
        : description.kind === "workspace.board" ? await storage.get(`board-file/${objectId}`) : undefined;
      const sourceRecord = (await storage.get(`source-lineage/${objectId}`))?.value as { sourceReferences: AssetSourceReference[]; sourceResolution?: "unavailable" } | undefined;
      return { ...description, ...sourceRecord, structuredType: (await storage.get(`visual-block-type/${objectId}`))?.value as { id: string; version: string } | undefined, fileBinding: binding?.value as { mountId: string; path: string } | undefined };
    },
    migrateBoard,
    readRaw: async (ref: { objectId: string; revision?: string }) => {
      const head = await storage.get(headKey(ref.objectId));
      const metadata = head?.value as
        { scopeId?: string; lifecycle?: string } | undefined;
      if (metadata?.scopeId !== scopeId || metadata.lifecycle === "tombstoned")
        throw new ObjectStoreError("object_not_found", "内容不可用。");
      const row = ref.revision
        ? await storage.get(
            revisionKey({ objectId: ref.objectId, revision: ref.revision }),
          )
        : head;
      if (!row || (row.value as { scopeId?: string }).scopeId !== scopeId)
        throw new ObjectStoreError("object_not_found", "内容不可用。");
      return row.value;
    },
    readAsset: async (assetId: string) => {
      const row = await storage.get(`asset/${assetId}`);
      if (!row) throw new ObjectStoreError("object_not_found", "图片不可用。");
      return row.value as StagedObjectAsset;
    },
    createImage: async (asset: StagedObjectAsset, text: string) => {
      const { base64: _base64, ...descriptor } = asset;
      const object = make({
        kind: "content.note",
        title: text || "图片",
        assets: [descriptor],
        content: {
          schema: "liteasy.note/v1",
          payload: { text, origin: "external", assetIds: [asset.assetId] },
        },
      });
      const changes = objectChanges(object);
      if (!(await storage.get(`asset/${asset.assetId}`)))
        changes.push(change(`asset/${asset.assetId}`, asset));
      await storage.commit(changes);
      return object;
    },
    listBoardRelations: async (boardId: string) => {
      const placements = await listPlacements(boardId);
      const refs = new Set(placements.map((p) => JSON.stringify(p.ref)));
      const result: ObjectRelation[] = [];
      let cursor = "";
      do {
        const rows = await storage.list("relation/", cursor, 1000);
        for (const row of rows) {
          const relation = row.value as ObjectRelation;
          if (
            refs.has(JSON.stringify(relation.from)) &&
            refs.has(JSON.stringify(relation.to)) &&
            relation.reviewStatus === "accepted"
          )
            result.push(relation);
        }
        cursor = rows.length === 1000 ? rows[rows.length - 1].key : "";
      } while (cursor);
      return result;
    },
    saveRunRecord: async (run: {
      runId: string;
      status: string;
      createdAt: string;
      completedAt?: string;
      contextSnapshotId?: string;
      input: { message: string };
    }) => {
      const key = `run/${run.runId}`;
      if (await storage.get(key)) return;
      await storage.commit([
        change(key, {
          runId: run.runId,
          status: run.status,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
          contextSnapshotId: run.contextSnapshotId,
          question: run.input.message,
        }),
      ]);
    },
    getRunRecord: async (runId: string) =>
      (await storage.get(`run/${runId}`))?.value as
        { status: string; createdAt: string; question: string } | undefined,
    listEdges: async (boardId: string): Promise<BoardConnection[]> => {
      await resolveLatest(boardId);
      return (await storage.list(`edge/${boardId}/`, "", 1000)).map(
        (row) => row.value as BoardConnection,
      );
    },
    connectPlacements: async (input: {
      boardRef: ObjectRef;
      from: { placementId: string; revision: string; side: BoardSide };
      to: { placementId: string; revision: string; side: BoardSide };
      label?: string;
      operationId: string;
    }) =>
      commitOperation(input.operationId, input, async () => {
        const head = await storage.get(headKey(input.boardRef.objectId));
        const board = readObject(head);
        if (
          board.kind !== "workspace.board" ||
          board.lifecycle !== "active" ||
          board.revision !== input.boardRef.revision
        )
          throw new ObjectStoreError(
            "revision_conflict",
            "白板已变化，请刷新后重试。",
          );
        if (input.from.placementId === input.to.placementId)
          throw new ObjectStoreError(
            "capability_denied",
            "请选择另一张卡片建立连接。",
          );
        const endpoints = await Promise.all(
          [input.from, input.to].map(async (endpoint) => {
            if (!["top", "right", "bottom", "left"].includes(endpoint.side))
              throw new ObjectStoreError("capability_denied", "连接端点无效。");
            const row = await storage.get(
              `placement/${board.objectId}/${endpoint.placementId}`,
            );
            const p = row?.value as Placement | undefined;
            if (!p || p.revision !== endpoint.revision)
              throw new ObjectStoreError(
                "revision_conflict",
                "连接的卡片已变化，请重试。",
              );
            await get(p.ref);
            return p;
          }),
        );
        const edge: BoardConnection = {
          edgeId: id(),
          from: endpoints[0].placementId,
          to: endpoints[1].placementId,
          fromSide: input.from.side,
          toSide: input.to.side,
          kind: "related_to",
          label: input.label,
          relationId: id(),
        };
        const next = make({ ...board, ...board.provenance }, board);
        return {
          changes: [
            ...objectChanges(next, head),
            change(`edge/${board.objectId}/${edge.edgeId}`, edge),
            change(`relation/board-link/${board.objectId}/${edge.edgeId}`, {
              relationId: edge.relationId!,
              revision: id(),
              from: endpoints[0].ref,
              to: endpoints[1].ref,
              predicate: "related_to",
              scopeId,
              assertedBy: { type: "user", id: scopeId },
              createdAt: next.updatedAt,
              basis: {
                type: "user_judgment",
                reason: input.label || "用户在白板中连接卡片",
              },
              reviewStatus: "accepted",
            } satisfies ObjectRelation),
          ],
          result: [refOf(next)],
        };
      }),
    removeConnection: async (boardRef: ObjectRef, edgeId: string) => {
      const head = await storage.get(headKey(boardRef.objectId));
      const board = readObject(head);
      if (
        board.kind !== "workspace.board" ||
        board.revision !== boardRef.revision
      )
        throw new ObjectStoreError(
          "revision_conflict",
          "白板已变化，请刷新后重试。",
        );
      const key = `edge/${board.objectId}/${edgeId}`;
      const row = await storage.get(key);
      if (!row) throw new ObjectStoreError("revision_conflict", "连接已移除。");
      const relationKey = `relation/board-link/${board.objectId}/${edgeId}`;
      const relation = await storage.get(relationKey);
      const next = make({ ...board, ...board.provenance }, board);
      await storage.commit([
        ...objectChanges(next, head),
        { key, expected: row.version, row: null },
        ...(relation
          ? [{ key: relationKey, expected: relation.version, row: null }]
          : []),
      ]);
      return next;
    },
    getObjectFileBinding: async (
      objectId: string,
    ): Promise<
      | {
          mountId: string;
          path: string;
          version: string | null;
          objectRevision?: string;
        }
      | undefined
    > => {
      await resolveLatest(objectId);
      return (await storage.get(`object-file/${objectId}`))?.value as
        | {
            mountId: string;
            path: string;
            version: string | null;
            objectRevision?: string;
          }
        | undefined;
    },
    setObjectFileBinding: async (
      objectId: string,
      binding: {
        mountId: string;
        path: string;
        version: string | null;
        objectRevision?: string;
      },
    ) => {
      const object = await resolveLatest(objectId);
      const value = {
        ...binding,
        objectRevision: binding.objectRevision ?? object.revision,
      };
      const key = `object-file/${objectId}`;
      const row = await storage.get(key);
      if (JSON.stringify(row?.value) === JSON.stringify(value)) return;
      await storage.commit([change(key, value, row?.version ?? null)]);
    },
    getBoardFileBinding: async <T = unknown>(
      boardId: string,
    ): Promise<T | undefined> => {
      await resolveLatest(boardId);
      return (await storage.get(`board-file/${boardId}`))?.value as
        T | undefined;
    },
    setBoardFileBinding: async (boardId: string, binding: unknown) => {
      const board = await resolveLatest(boardId);
      if (board.kind !== "workspace.board")
        throw new ObjectStoreError("capability_denied", "请选择白板。");
      const key = `board-file/${boardId}`;
      const row = await storage.get(key);
      await storage.commit([change(key, binding, row?.version ?? null)]);
    },
    importBoardFile: async (input: {
      title: string;
      presentation?: BlockPresentation;
      replaceRef?: ObjectRef;
      nodes: Array<{
        id: string;
        draft?: ObjectDraft;
        presentation?: BlockPresentation;
        attachmentBase?: { mountId: string; path: string };
        structured?: StructuredBlock;
        ref?: ObjectRef;
        position: Placement["position"];
        size: Placement["size"];
      }>;
      edges: BoardConnection[];
      operationId: string;
    }) => {
      const result = await commitOperation(
        input.operationId,
        input,
        async () => {
          const previousHead = input.replaceRef
            ? await storage.get(headKey(input.replaceRef.objectId))
            : null;
          const previous = previousHead ? readObject(previousHead) : undefined;
          if (
            input.replaceRef &&
            (!previous ||
              previous.kind !== "workspace.board" ||
              previous.lifecycle !== "active" ||
              previous.revision !== input.replaceRef.revision)
          )
            throw new ObjectStoreError(
              "revision_conflict",
              "白板已变化，请先保存本地修改。",
            );
          const board = make(
            {
              kind: "workspace.board",
              title: input.title,
              content: {
                schema: "liteasy.board/v1",
                payload: previous?.kind === "workspace.board" ? previous.content.payload : { description: "" },
              },
            },
            previous,
          );
          const changes = objectChanges(board, previousHead);
          const oldRows = new Map<string, StorageRow>();
          if (previous) {
            for (const prefix of [
              `block-presentation/${board.objectId}/`,
              `placement/${board.objectId}/`,
              `edge/${board.objectId}/`,
              `relation/board-link/${board.objectId}/`,
              `relation/member_of/${board.objectId}/`,
            ]) {
              for (const row of await storage.list(prefix, "", 1000))
                oldRows.set(row.key, row);
            }
          }
          if (input.presentation) changes.push(change(`block-presentation/${board.objectId}/$board`, blockPresentationSchema.parse(input.presentation)));
          const nodes = new Map<string, Placement>();
          const memberships = new Set<string>();
          for (const node of input.nodes) {
            if (
              !node.id ||
              nodes.has(node.id) ||
              ![
                node.position.x,
                node.position.y,
                node.size.width,
                node.size.height,
              ].every(Number.isFinite) ||
              node.size.width <= 0 ||
              node.size.height <= 0
            )
              throw new ObjectStoreError(
                "unsupported_schema",
                "白板包含无效或重复的卡片。",
              );
            const object = node.ref
              ? await get(node.ref)
              : node.draft
                ? make(node.draft)
                : null;
            if (!object)
              throw new ObjectStoreError(
                "unsupported_schema",
                "白板卡片缺少内容。",
              );
            if (!node.ref) changes.push(...objectChanges(object));
            if (node.attachmentBase && !node.ref) changes.push(change(`object-attachment/${object.objectId}`, { mountId: node.attachmentBase.mountId, path: node.attachmentBase.path, external: true }));
            if (node.structured && !node.ref) changes.push(change(`visual-block/${object.objectId}/${object.revision}`, structuredBlockSchema.parse(node.structured)), change(`visual-block-type/${object.objectId}`, node.structured.type));
            const p: Placement = {
              ...placement(board.objectId, refOf(object)),
              placementId: node.id,
              position: node.position,
              size: node.size,
            };
            if (node.presentation) changes.push(change(`block-presentation/${board.objectId}/${node.id}`, blockPresentationSchema.parse(node.presentation)));
            nodes.set(node.id, p);
            changes.push(
              change(`placement/${board.objectId}/${p.placementId}`, p),
            );
            if (!memberships.has(object.objectId)) {
              memberships.add(object.objectId);
              changes.push(
                change(
                  membershipKey(board.objectId, object.objectId),
                  membership(board, p.ref),
                ),
              );
            }
          }
          const ids = new Set<string>();
          for (const source of input.edges) {
            const from = nodes.get(source.from),
              to = nodes.get(source.to);
            if (!from || !to || !source.edgeId || ids.has(source.edgeId))
              throw new ObjectStoreError(
                "unsupported_schema",
                "白板包含无效或重复的连接。",
              );
            ids.add(source.edgeId);
            const edge: BoardConnection = { ...source, relationId: id() };
            changes.push(
              change(`edge/${board.objectId}/${edge.edgeId}`, edge),
              change(`relation/board-link/${board.objectId}/${edge.edgeId}`, {
                relationId: edge.relationId!,
                revision: id(),
                from: from.ref,
                to: to.ref,
                predicate: "related_to",
                scopeId,
                assertedBy: { type: "user", id: scopeId },
                createdAt: board.createdAt,
                basis: {
                  type: "user_judgment",
                  reason: source.label || "用户导入白板连接",
                },
                reviewStatus: "accepted",
              } satisfies ObjectRelation),
            );
          }
          for (const item of changes) {
            const old = oldRows.get(item.key);
            if (old) {
              item.expected = old.version;
              oldRows.delete(item.key);
            }
          }
          for (const row of oldRows.values())
            changes.push({ key: row.key, expected: row.version, row: null });
          return { changes, result: [refOf(board)] };
        },
      );
      return get(result[0]);
    },
    setLifecycle: async (
      ref: ObjectRef,
      lifecycle: ObjectEnvelope["lifecycle"],
    ) => {
      const head = await storage.get(headKey(ref.objectId));
      const current = readObject(head);
      if (current.revision !== ref.revision)
        throw new ObjectStoreError("revision_conflict", "内容已变化。");
      const next = {
        ...current,
        lifecycle,
        revision: id(),
        updatedAt: new Date().toISOString(),
      };
      await storage.commit(objectChanges(next, head));
      return next;
    },
    get,
    resolveLatest,
    create,
    search,
    searchTitles,
    listRelations,
    relate,
    captureFragment: captureObject,
    createAndPlace: captureObject,
    applyBoardPatch,
    restoreBoardLayout,
    listPlacements,
    commitOperation,
    editNote,
    editPlacement,
    copy,
    history: async (objectId: string) => {
      await resolveLatest(objectId);
      return (await storage.list(`revision/${objectId}/`, "", 1000))
        .map(readObject)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    saveSnapshot: async (snapshot: { snapshotId: string }) =>
      storage.commit([change(`snapshot/${snapshot.snapshotId}`, snapshot)]),
    getSnapshot: async (snapshotId: string) =>
      (await storage.get(`snapshot/${snapshotId}`))?.value,
    async fileProjectionIds() {
      const ids = new Set<string>();
      let cursor = "";
      do {
        const rows = await storage.list("legacy/note-file-", cursor, 1000);
        for (const row of rows) ids.add((row.value as ObjectRef).objectId);
        cursor = rows.length === 1000 ? rows.at(-1)!.key : "";
      } while (cursor);
      return ids;
    },
    projectLegacy: async (key: string, draft: ObjectDraft) => {
      const mapping = await storage.get(`legacy/${key}`);
      const ref = mapping?.value as ObjectRef | undefined;
      if (!ref) {
        const result = await commitOperation(
          `legacy-${key}`,
          { key },
          async () => {
            const object = make(draft);
            return {
              changes: [
                ...objectChanges(object),
                ...await sourceChanges(object.objectId, draft),
                change(`legacy/${key}`, refOf(object)),
              ],
              result: [refOf(object)],
            };
          },
        );
        return get(result[0]);
      }
      const head = await storage.get(headKey(ref.objectId));
      const current = readObject(head);
      const next = make(draft, current);
      const lineageChanges = await sourceChanges(current.objectId, draft);
      if (
        JSON.stringify(current.content) === JSON.stringify(next.content) &&
        JSON.stringify(current.assets) === JSON.stringify(next.assets) &&
        JSON.stringify(current.paperAnchors) === JSON.stringify(next.paperAnchors) &&
        current.title === next.title
      ) {
        if (lineageChanges.length) await storage.commit(lineageChanges);
        return current;
      }
      await storage.commit([
        ...objectChanges(next, head),
        ...lineageChanges,
        change(`legacy/${key}`, refOf(next), mapping!.version),
      ]);
      return next;
    },
    legacy: async (key: string, draft: ObjectDraft) => {
      const ref = (await storage.get(`legacy/${key}`))?.value as
        ObjectRef | undefined;
      if (ref) return get(ref);
      const result = await commitOperation(
        `legacy-${key}`,
        { key },
        async () => {
          const object = make(draft);
          return {
            changes: [
              ...objectChanges(object),
              change(`legacy/${key}`, refOf(object)),
            ],
            result: [refOf(object)],
          };
        },
      );
      return get(result[0]);
    },
  };
}
