import { hashText } from "../context/objectContext";
import type { StagedObjectAsset } from "./objectAssets";
import {
  objectContentSchema,
  parseObject,
  refOf,
  objectText,
  ObjectStoreError,
  type ObjectContent,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
  type ObjectRelation,
} from "./object.types";
import type { ObjectStorage, StorageChange, StorageRow } from "./objectStorage";

export type ObjectDraft = ObjectContent & {
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
            title: object.title,
            lifecycle: object.lifecycle,
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
        for (const move of input.move ?? []) {
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
    draft: ObjectDraft;
    assets?: StagedObjectAsset[];
    boardRef?: ObjectRef;
    operationId: string;
  }) {
    return commitOperation(
      input.operationId,
      { ...input, boardRef: input.boardRef?.objectId },
      async () => {
        if (input.draft.kind === "content.fragment")
          for (const anchor of input.draft.content.payload.anchors)
            await get(anchor.sourceRef);
        for (const source of input.draft.sourceRefs ?? []) await get(source);
        const object = make(input.draft);
        const changes = objectChanges(object);
        for (const asset of input.assets ?? [])
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
          changes.push(
            change(`placement/${board.objectId}/${p.placementId}`, p),
            change(
              membershipKey(board.objectId, object.objectId),
              membership(board, refOf(object)),
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
  async function search(query = "", cursor = "") {
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
          entry.lifecycle !== "active" ||
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
  async function editNote(ref: ObjectRef, text: string, title?: string) {
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
        "摘录为只读，请制作独立副本。",
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
        content: {
          schema: "liteasy.note/v1",
          payload: { text: objectText(source), origin: "derived" },
        },
        sourceRefs: [ref],
        derivedFrom: [ref],
      },
      operationId,
    );
    return object;
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
    listEdges: async (boardId: string) => {
      await resolveLatest(boardId);
      return (await storage.list(`edge/${boardId}/`, "", 1000)).map(
        (row) =>
          row.value as {
            edgeId: string;
            from: string;
            to: string;
            kind: string;
            label?: string;
          },
      );
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
    listRelations,
    relate,
    captureFragment: captureObject,
    createAndPlace: captureObject,
    applyBoardPatch,
    listPlacements,
    commitOperation,
    editNote,
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
      if (
        JSON.stringify(current.content) === JSON.stringify(draft.content) &&
        current.title === draft.title
      )
        return current;
      const next = make(draft, current);
      await storage.commit([
        ...objectChanges(next, head),
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
