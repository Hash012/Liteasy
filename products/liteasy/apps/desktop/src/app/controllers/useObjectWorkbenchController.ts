import { paperAnchorsForArtifact } from "../features/paper-anchors/paperAnchorAdapters";
import { createNoteFileService } from "../features/note-files/noteFileService";
import { resolveLiteasyContext, contextAttachments } from "../features/resource-filesystem/resourceContext";
import { describeResourceLocation } from "../features/resource-filesystem/resourceLocation";
import { paperAnchorOpenRequest } from "../features/paper-anchors/paperAnchorEntity";
import { ARTIFACT_CONTEXT_MIME } from "../features/object-transfer/contextTransfer";
import { artifactContextText } from "../features/artifacts/artifactContext";
import { useBoardFileController } from "./useBoardFileController";
import { loadUserPaperArtifact } from "../features/library/userPaperArtifactClient";
import { normalizePaperFulltext } from "../features/pdf/paperFulltextStore";
import { preparePdfAnnotationCapture } from "../features/pdf/pdfAnnotationCapture";
import { PDF_ANNOTATION_REVIEW_PROMPT } from "../features/pdf/pdfAnnotationReviewContent";
import { NOTES_REFERENCE_MIME } from "../features/notes/notesPort";
import { isTauri } from "@tauri-apps/api/core";
import {
  createObjectResolver,
  type ResolvedObject,
} from "../features/objects/objectResolver";
import {
  assetDescriptor,
  stageDataUrl,
  stageImage,
  type StagedObjectAsset,
} from "../features/objects/objectAssets";
import { useEffect, useMemo, useRef, useState } from "react";
import { createObjectStorage } from "../features/objects/objectStorage";
import {
  createObjectRepository,
  type ObjectDraft,
} from "../features/objects/objectRepository";
import {
  objectText,
  refOf,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
  type BoardSide,
} from "../features/objects/object.types";
import type {
  ObjectWorkbenchPort,
  PdfCaptureInput,
  MessageCaptureInput,
  PdfAnnotationCaptureInput,
} from "../features/objects/objectWorkbenchPort";
import {
  createCaptureTickets,
  PENDING_CAPTURE_MIME,
  readObjectTransfer,
} from "../features/object-transfer/objectTransfer";
import {
  hashText,
  resolveContextSnapshot,
  type ContextRef,
  type ContextSnapshot,
} from "../features/context/objectContext";
import type {
  AgentPublicApi,
  AgentRun,
  SubmitAgentTurnRequest,
} from "../features/agent-api/agentApi.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { PdfEvidenceTarget } from "../features/pdf/PdfReader";
import type { SettingsState } from "../features/settings/settings.types";
import { describeObjectSetting } from "../features/settings/settingsRegistry";
import { resolveObjectAnchor } from "../features/objects/objectAnchors";

export function useObjectWorkbenchController(input: {
  scopeId: string;
  artifactScopeId?: string;
  getApi: () => AgentPublicApi;
  getPapers: () => Paper[];
  getSettings: () => SettingsState;
  readPaperBytes?: (sourcePath: string) => Promise<Uint8Array>;
  listLegacyArtifacts?: () => Promise<
    import("../features/artifacts/artifact.types").AgentArtifactResult[]
  >;
  openLegacyArtifact?: (artifactId: string) => void;
  openEvidence: (target: Omit<PdfEvidenceTarget, "requestId">) => void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const repository = useMemo(
    () =>
      createObjectRepository(
        createObjectStorage(input.scopeId, () => latest.current.scopeId),
        input.scopeId,
      ),
    [input.scopeId],
  );
  const [opened, setOpened] = useState<ResolvedObject>();
  const [visible, setVisible] = useState(false);
  const closeGeneration = useRef(0);
  function close() {
    closeGeneration.current += 1;
    setOpened(undefined);
    setVisible(false);
  }
  const [objects, setObjects] = useState<ObjectEnvelope[]>([]);
  const [board, setBoard] = useState<ObjectEnvelope>();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [tray, setTray] = useState<Array<{ ref: ContextRef; pinned: boolean }>>(
    [],
  );
  const [preview, setPreview] = useState<ContextSnapshot>();
  const [answer, setAnswer] = useState<{ text: string; run: AgentRun }>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingFragments = useMemo(
    () => new Map<string, ObjectDraft & { kind: "content.fragment" }>(),
    [repository],
  );
  const boardRef = useRef(board);
  boardRef.current = board;
  const pending = useRef(new Set<{ api: AgentPublicApi; sessionId: string }>());
  const isolatedContextSessions = useRef(new Set<string>());
  const tickets = useMemo(createCaptureTickets, [input.scopeId]);
  const mounted = useRef(true);
  const active = () =>
    mounted.current && latest.current.scopeId === repository.scopeId;
  async function refresh() {
    const all: ObjectEnvelope[] = [];
    let cursor: string | undefined;
    do {
      const page = await repository.search("", cursor);
      all.push(...page.objects);
      cursor = page.cursor;
    } while (cursor);
    if (!active()) return;
    const current = boardRef.current;
    const next =
      (current && all.find((o) => o.objectId === current.objectId)) ||
      all.find((o) => o.kind === "workspace.board");
    const nextPlacements = next
      ? await repository.listPlacements(next.objectId)
      : [];
    if (!active()) return;
    setObjects(all);
    boardRef.current = next;
    setBoard(next);
    setPlacements((previous) => {
      const cache = new Map(previous.map((p) => [p.placementId, p]));
      return nextPlacements.map((p) =>
        cache.get(p.placementId)?.revision === p.revision
          ? cache.get(p.placementId)!
          : p,
      );
    });
  }
  useEffect(() => {
    mounted.current = true;
    setOpened(undefined);
    setObjects([]);
    setBoard(undefined);
    boardRef.current = undefined;
    setPlacements([]);
    setTray([]);
    setPreview(undefined);
    setAnswer(undefined);
    setStatus("");
    setBusy(false);
    return () => {
      mounted.current = false;
      tickets.clear();
      pendingFragments.clear();
      for (const session of pending.current)
        void session.api.closeSession(session.sessionId);
      pending.current.clear();
    };
  }, [repository, tickets]);
  useEffect(() => {
    if (visible)
      void refresh().catch((e) => {
        if (active()) setStatus(String(e.message ?? e));
      });
  }, [visible, repository]);
  async function selectBoard(object: ObjectEnvelope) {
    if (object.kind !== "workspace.board") throw new Error("此内容不是白板。");
    boardRef.current = object;
    setOpened(undefined);
    setVisible(true);
    await refresh();
  }
  const boardFiles = useBoardFileController({ repository, board, active, select: selectBoard, setStatus });
  async function openLink(link: string) {
    const generation = closeGeneration.current;
    if (link.startsWith("liteasy://agent-artifacts/")) {
      const url = new URL(link);
      latest.current.openLegacyArtifact?.(
        decodeURIComponent(url.pathname.slice(1)),
      );
      return;
    }
    const result = await createObjectResolver(repository).open(link);
    if (active() && generation === closeGeneration.current) {
      if ("object" in result && result.object.kind === "workspace.board") {
        await selectBoard(await repository.resolveLatest(result.object.objectId));
      } else {
        setOpened(result);
        setVisible(true);
      }
    }
  }
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]");
      const link = anchor?.getAttribute("href");
      if (
        link?.startsWith("liteasy://objects/") ||
        link?.startsWith("liteasy://agent-artifacts/")
      ) {
        event.preventDefault();
        void openLinkRef.current(link);
      }
    };
    document.addEventListener("click", click);
    let stop: (() => void) | undefined,
      disposed = false;
    if (isTauri())
      void import("@tauri-apps/plugin-deep-link")
        .then(async ({ getCurrent, onOpenUrl }) => {
          const listener = await onOpenUrl((links) =>
            links.forEach((link) => void openLinkRef.current(link)),
          );
          if (disposed) listener();
          else stop = listener;
          const links = await getCurrent();
          if (!disposed)
            links?.forEach((link) => void openLinkRef.current(link));
        })
        .catch(() => setStatus("内容链接监听不可用，可粘贴链接打开。"));
    return () => {
      disposed = true;
      stop?.();
      document.removeEventListener("click", click);
    };
  }, []);
  async function perform<T>(
    action: () => Promise<T>,
    rethrow = false,
  ): Promise<T | undefined> {
    setStatus("保存中…");
    try {
      const result = await action();
      await refresh();
      if (active()) setStatus("已保存到本机");
      return result;
    } catch (e) {
      if (active())
        setStatus(e instanceof Error ? e.message : "保存失败，请重试。");
      if (rethrow) throw e;
      return undefined;
    }
  }
  async function ensureBoard() {
    if (boardRef.current)
      return repository.resolveLatest(boardRef.current.objectId);
    const existing = (await repository.search()).objects.find(
      (o) => o.kind === "workspace.board",
    );
    const next =
      existing ??
      (await repository.create(
        {
          kind: "workspace.board",
          title: "研究白板",
          content: { schema: "liteasy.board/v1", payload: { description: "" } },
        },
        "default-research-board",
      ));
    boardRef.current = next;
    if (active()) setBoard(next);
    return next;
  }
  async function documentHash(paper: Paper) {
    if (!paper.sourcePath || !latest.current.readPaperBytes)
      return paper.contentHash;
    if (/^https?:/i.test(paper.sourcePath)) return paper.contentHash;
    const bytes = await latest.current.readPaperBytes(paper.sourcePath);
    const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }
  async function pdfDraft(
    selection: PdfCaptureInput,
  ): Promise<ObjectDraft & { kind: "content.fragment" }> {
    const paper = latest.current
      .getPapers()
      .find((p) => p.id === selection.paper.id);
    if (!paper) throw new Error("来源文献在当前账号不可用。");
    const hash = await documentHash(paper);
    const sourceDraft: ObjectDraft = {
      kind: "source.document",
      title: paper.title,
      content: {
        schema: "liteasy.source-document/v1",
        payload: {
          paperId: paper.id,
          literatureId: paper.literature?.literatureId,
          documentHash: hash,
          text: paper.title,
          availability: "local",
          legacyKey: paper.id,
        },
      },
    };
    let source = await repository.legacy(`paper-${paper.id}`, sourceDraft);
    // A capture must not replace an existing full-text representation with metadata.
    // A verified change of PDF bytes, however, needs a new source version.
    if (source.kind === "source.document" && hash && source.content.payload.documentHash !== hash) {
      source = await repository.projectLegacy(`paper-${paper.id}`, sourceDraft);
    }
    return {
      kind: "content.fragment",
      title: `${paper.title} · 第 ${selection.page} 页`,
      sourceRefs: [refOf(source)],
      content: {
        schema: "liteasy.fragment/v1",
        payload: {
          text: selection.excerpt,
          partial: false,
          anchors: [
            {
              type: "pdf",
              sourceRef: refOf(source),
              documentHash: hash,
              page: selection.page,
              quote: { exact: selection.excerpt, prefix: "", suffix: "" },
              rects: selection.rects.map((rect) => ({
                x: rect.left / 100,
                y: rect.top / 100,
                width: rect.width / 100,
                height: rect.height / 100,
              })),
              extractor: "liteasy.pdf-text/v1",
              normalization: "liteasy.whitespace/v1",
              precision: hash ? "exact" : "page",
              ...(selection.normalizedStart === undefined
                ? {}
                : {
                    range: {
                      start: selection.normalizedStart,
                      end: selection.normalizedStart + selection.excerpt.length,
                    },
                  }),
            },
          ],
        },
      },
    };
  }
  async function messageDraft(
    message: MessageCaptureInput,
  ): Promise<ObjectDraft & { kind: "content.fragment" }> {
    if (!message.text.includes(message.excerpt) || !message.excerpt.trim())
      throw new Error("请选择回答中的有效文字。");
    const hash = await hashText(message.paperAnchors?.length
      ? JSON.stringify({ text: message.text, paperAnchors: message.paperAnchors }) : message.text);
    const source = await repository.legacy(
      `message-${message.messageId}-${hash}`,
      {
        kind: "conversation.message",
        paperAnchors: message.paperAnchors,
        title: message.partial ? "回答（生成中快照）" : "回答",
        content: {
          schema: "liteasy.message/v1",
          payload: {
            messageId: message.messageId,
            blockId: "body",
            text: message.text,
            partial: message.partial,
          },
        },
      },
    );
    const start = message.text.indexOf(message.excerpt);
    return {
      kind: "content.fragment",
      title: `${message.partial ? "未完成回答" : "回答"}摘录`,
      paperAnchors: message.paperAnchors,
      sourceRefs: [refOf(source)],
      content: {
        schema: "liteasy.fragment/v1",
        payload: {
          text: message.excerpt,
          partial: message.partial,
          anchors: [
            {
              type: "text",
              sourceRef: refOf(source),
              blockId: "body",
              quote: {
                exact: message.excerpt,
                prefix: message.text.slice(Math.max(0, start - 32), start),
                suffix: message.text.slice(
                  start + message.excerpt.length,
                  start + message.excerpt.length + 32,
                ),
              },
              range: { start, end: start + message.excerpt.length },
            },
          ],
        },
      },
    };
  }
  async function capture(
    draft: () => Promise<ObjectDraft & { kind: "content.fragment" }>,
    target: "board" | "tray" | "saved",
    operationId: string = crypto.randomUUID(),
  ) {
    const generation = closeGeneration.current;
    const captured = await draft();
    if (!active()) throw new Error("账号已切换。");
    if (target === "tray") {
      const ref = { objectId: `pending-${operationId}`, revision: "pending" };
      pendingFragments.set(ref.objectId, captured);
      addToTray([ref], generation === closeGeneration.current);
      setStatus("已加入对话，提交提问时保存摘录。");
      return [ref];
    }
    const refs = await repository.captureFragment({
      draft: captured,
      boardRef: target === "board" ? refOf(await ensureBoard()) : undefined,
      operationId,
    });
    if (!active()) throw new Error("账号已切换。");
    if (target !== "saved" && generation === closeGeneration.current) setVisible(true);
    await refresh();
    setStatus("已保存到本机");
    return refs;
  }
  function addToTray(refs: ContextRef[], reveal = true) {
    setTray((current) => [
      ...current,
      ...refs
        .filter(
          (ref) =>
            !current.some(
              (item) => JSON.stringify(item.ref) === JSON.stringify(ref),
            ),
        )
        .map((ref) => ({ ref, pinned: false })),
    ]);
    setPreview(undefined);
    if (reveal) setVisible(true);
  }
  async function captureAnnotation(
    selection: PdfAnnotationCaptureInput,
    target: "board" | "tray" | "saved",
    operationId: string = crypto.randomUUID(),
  ) {
    const generation = closeGeneration.current;
    const material = await preparePdfAnnotationCapture(selection);
    const draft = await pdfDraft({
      paper: selection.paper,
      page: selection.annotation.page,
      excerpt: material.quote,
      rects: material.rects,
      normalizedStart: selection.annotation.normalizedStart,
    });
    const assets = await Promise.all(
      Object.entries(material.images).map(async ([key, dataUrl]) => ({
        key,
        asset: await stageDataUrl(dataUrl),
      })),
    );
    draft.title = `${selection.paper.title} · 第 ${selection.annotation.page} 页 · ${selection.annotation.kind === "ink" ? "手绘笔记" : "批注"}`;
    draft.content.payload.text = material.text;
    draft.assets = [
      ...new Map(
        assets.map(({ asset }) => [asset.assetId, assetDescriptor(asset)]),
      ).values(),
    ];
    for (const { key, asset } of assets)
      draft.content.payload.text = draft.content.payload.text
        .split(`attachment:${key}`)
        .join(`attachment:${asset.assetId}`);
    if (!active()) throw new Error("账号已切换。");
    const refs = await repository.captureFragment({
      operationId,
      legacyKey: `pdf-annotation-${selection.paper.id}-${selection.annotation.id}`,
      draft,
      assets: assets.map(({ asset }) => asset),
      boardRef: target === "board" ? refOf(await ensureBoard()) : undefined,
    });
    if (!active()) throw new Error("账号已切换。");
    if (target === "tray") addToTray(refs, false);
    if (target !== "saved" && generation === closeGeneration.current) setVisible(true);
    await refresh();
    setStatus("已保存到本机");
    return refs;
  }
  const port: ObjectWorkbenchPort = {
    scopeId: repository.scopeId,
    resolveLiteasyPath: (path) => resolveLiteasyContext({ path, repository, active,
      artifactScopeId: latest.current.artifactScopeId ?? "device",
      files: createNoteFileService(repository.scopeId, () => latest.current.scopeId),
      getPapers: () => latest.current.getPapers(), getArtifacts: () => latest.current.listLegacyArtifacts?.() ?? Promise.resolve([]),
      capturePapers: (ids) => port.capturePaperContext!(ids),
      captureAnnotation: (selection) => captureAnnotation(selection, "saved"),
      resolveBoard: boardFiles.resolveBoardFile,
    }),
    describeResource: (target, reveal) => describeResourceLocation({ target, reveal, repository, active,
      files: createNoteFileService(repository.scopeId, () => latest.current.scopeId),
      getPapers: () => latest.current.getPapers(), artifactScopeId: latest.current.artifactScopeId ?? "device" }),
    dragBoardFile(file, data) {
      const ticket = tickets.register(async () => [await boardFiles.resolveBoardFile(file)]);
      data.setData(PENDING_CAPTURE_MIME, ticket);
      data.setData("text/plain", file.name);
      data.effectAllowed = "copy";
    },
    openBoardFile: boardFiles.openBoardFile,
    resolveBoardFile: boardFiles.resolveBoardFile,
    serializeBoardFile: boardFiles.serializeBoardFile,
    async reviewAnnotation(selection, signal) {
      if (signal.aborted || !active()) throw new Error("Review 已取消。");
      const refs = await captureAnnotation(selection, "saved");
      return ask(PDF_ANNOTATION_REVIEW_PROMPT, refs, signal, false);
    },
    isOpen: visible,
    close,
    async capturePaperContext(paperIds) {
      const refs: ObjectRef[] = [];
      for (const paperId of [...new Set(paperIds)]) {
        const paper = latest.current.getPapers().find((item) => item.id === paperId);
        if (!paper || !active()) throw new Error("来源文献在当前工作区不可用。");
        const fulltext = normalizePaperFulltext(await loadUserPaperArtifact({ artifactKind: "fulltext", paperId }));
        if (!fulltext?.pages.some((page) => page.text.trim()))
          throw new Error(`《${paper.title}》的正文尚未就绪，请完成解析后重试。`);
        const source = await repository.projectLegacy(`paper-${paper.id}`, {
          kind: "source.document", title: paper.title,
          content: { schema: "liteasy.source-document/v1", payload: {
            paperId, legacyKey: paperId, availability: "local", documentHash: await documentHash(paper),
            text: fulltext.pages.map((page) => `第 ${page.page} 页\n${page.text}`).join("\n\n"),
            pages: fulltext.pages.map((page) => ({ page: page.page, text: page.text })),
          } },
        });
        refs.push(refOf(source));
      }
      if (!active()) throw new Error("账号已切换。");
      return refs;
    },
    async receiveContextDrop(data) {
      // Read drag data synchronously: browsers protect it once the drop handler returns.
      const ticket = data.getData(PENDING_CAPTURE_MIME);
      const transfer = readObjectTransfer(data);
      const artifactId = data.getData(ARTIFACT_CONTEXT_MIME);
      let refs = ticket ? await tickets.consume(ticket) : transfer?.refs;
      if (!refs?.length && artifactId) {
        if (artifactId.length > 2048) throw new Error("产物标识无效。");
        const artifact = (await latest.current.listLegacyArtifacts?.())
          ?.find((item) => item.artifactId === artifactId);
        if (!artifact) throw new Error("这份产物在当前账号不可用，请刷新文库后重试。");
        if (!active()) throw new Error("账号已切换。");
        const text = artifactContextText(artifact);
        if (!text.trim()) throw new Error("这份产物尚未生成可添加的正文。");
        const object = await repository.projectLegacy(`artifact-context-${artifactId}`, {
          title: artifact.title,
          paperAnchors: paperAnchorsForArtifact(artifact),
          kind: "artifact.document",
          runId: artifact.agent.runId,
          content: { schema: "liteasy.document/v1", payload: {
            legacyArtifactId: artifactId,
            blocks: [{ blockId: "document", type: "markdown", text, sourceRefs: [] }],
          } },
        });
        refs = [refOf(object)];
      }
      if (!refs?.length) throw new Error("没有可加入对话的内容。");
      return contextAttachments(repository, refs, active);
    },
    async openPaperAnchor(anchor) {
      const request = paperAnchorOpenRequest(anchor);
      if (!active()) throw new Error("账号已切换。");
      if (!request) throw new Error("来源位置未记录，原文摘录仍可阅读。");
      const paper = latest.current.getPapers().find((candidate) => candidate.id === request.paperId);
      if (!paper) throw new Error("来源文献在当前工作区不可用，原文摘录仍可阅读。");
      if (anchor.source.objectRef) await repository.get(anchor.source.objectRef);
      if (anchor.source.documentHash && anchor.source.documentHash !== await documentHash(paper))
        throw new Error("来源版本已变化，原文摘录仍可阅读。");
      if (!active()) throw new Error("账号已切换。");
      latest.current.openEvidence(request);
    },
    async captureArtifactPage(page) {
      if (!page.text.trim()) throw new Error("当前页面还没有可收藏的正文。");
      const sourceRefs: ObjectRef[] = [];
      for (const paperId of page.paperIds) {
        const paper = latest.current.getPapers().find((item) => item.id === paperId);
        if (!paper) throw new Error("来源文献在当前工作区不可用。");
        sourceRefs.push(refOf(await repository.legacy(`paper-${paper.id}`, {
          kind: "source.document", title: paper.title,
          content: { schema: "liteasy.source-document/v1", payload: {
            paperId: paper.id, text: paper.title, availability: "local", legacyKey: paper.id,
          } },
        })));
      }
      if (!active()) throw new Error("账号已切换。");
      const object = await repository.projectLegacy(`artifact-page-${page.artifactId}-${page.pageId}`, {
        kind: "artifact.document", title: page.title, sourceRefs, paperAnchors: page.paperAnchors,
        content: { schema: "liteasy.document/v1", payload: {
          legacyArtifactId: page.artifactId,
          blocks: [{ blockId: page.pageId, type: "markdown", text: page.text, sourceRefs }],
        } },
      });
      await refresh();
      return { ...refOf(object), selectorId: page.pageId };
    },
    captureAnnotation,
    dragAnnotation(selection, data) {
      data.setData(NOTES_REFERENCE_MIME, JSON.stringify({ kind: "pdf-annotation", paperId: selection.paper.id, annotationId: selection.annotation.id }));
      const operationId = crypto.randomUUID();
      const ticket = tickets.register(() =>
        captureAnnotation(selection, "saved", operationId),
      );
      data.setData(PENDING_CAPTURE_MIME, ticket);
      data.setData(
        "text/plain",
        selection.annotation.note || selection.annotation.excerpt || "手绘笔记",
      );
    },
    capturePdf: (selection, target) =>
      capture(() => pdfDraft(selection), target),
    captureMessage: (message, target) =>
      capture(() => messageDraft(message), target),
    dragPdf(selection, data) {
      const operationId = crypto.randomUUID();
      const ticket = tickets.register(() =>
        capture(() => pdfDraft(selection), "saved", operationId),
      );
      data.setData(PENDING_CAPTURE_MIME, ticket);
      data.setData("text/plain", selection.excerpt);
    },
    dragMessage(message, data) {
      const operationId = crypto.randomUUID();
      const ticket = tickets.register(() =>
        capture(() => messageDraft(message), "saved", operationId),
      );
      data.setData(PENDING_CAPTURE_MIME, ticket);
      data.setData("text/plain", message.excerpt);
    },
    explain(ref) {
      setTray([{ ref, pinned: false }]);
      setPreview(undefined);
      setVisible(true);
    },
    async openLegacyBoard(paper, snapshot, key) {
      const generation = closeGeneration.current;
      if (
        !latest.current
          .getPapers()
          .some((candidate) => candidate.id === paper.id)
      )
        throw new Error("来源文献在当前账号不可用。");
      const assets = new Map<string, StagedObjectAsset>();
      const nodes = await Promise.all(
        snapshot.nodes.map(async (node) => {
          let draft: ObjectDraft;
          if (node.kind === "image") {
            const asset = await stageDataUrl(node.content.dataUrl);
            assets.set(asset.assetId, asset);
            draft = {
              kind: "content.note",
              title: node.content.alt || "图片",
              assets: [assetDescriptor(asset)],
              content: {
                schema: "liteasy.note/v1",
                payload: {
                  text: node.content.alt,
                  origin: "external",
                  assetIds: [asset.assetId],
                },
              },
            };
          } else if (
            node.kind === "markdown" &&
            node.source?.type === "pdf" &&
            node.source.page &&
            node.source.excerpt &&
            node.source.excerpt === node.content.markdown
          ) {
            const sourcePaper = latest.current
              .getPapers()
              .find(
                (p) => p.id === (node.source as { paperId: string }).paperId,
              );
            if (!sourcePaper)
              throw new Error("旧摘录来源不可用，原白板快照保持不变。");
            const fragment = await pdfDraft({
              paper: sourcePaper,
              page: node.source.page,
              excerpt: node.source.excerpt,
              rects: [],
            });
            for (const anchor of fragment.content.payload.anchors)
              if (anchor.type === "pdf") anchor.precision = "page";
            draft = fragment;
          } else {
            const text =
              node.kind === "markdown"
                ? node.content.markdown
                : node.content.title;
            draft = {
              kind: "content.note",
              title: text.slice(0, 80) || "旧白板内容",
              content: {
                schema: "liteasy.note/v1",
                payload: { text, origin: "external" },
              },
            };
          }
          return {
            legacyId: node.id,
            draft,
            position: node.position,
            size: node.size,
          };
        }),
      );
      const next = await repository.migrateBoard({
        key: await hashText(key),
        snapshot: {
          originalStorageKey: key,
          sha256: await hashText(JSON.stringify(snapshot)),
          schemaVersion: 1,
        },
        title: `${paper.title} · 白板`,
        paperId: paper.id,
        nodes,
        edges: snapshot.edges,
        assets: [...assets.values()],
      });
      boardRef.current = next;
      setBoard(next);
      if (generation === closeGeneration.current) setVisible(true);
      await refresh();
      setStatus("旧白板已迁移并保存；原快照保留。旧摘录仅定位到页。");
    },
    open() {
      setVisible(true);
    },
  };
  async function resolveContext(request: SubmitAgentTurnRequest) {
    return resolveContextSnapshot({
      repository,
      refs: request.contextRefs ?? [],
      pinnedRefs: isolatedContextSessions.current.has(request.sessionId) ? [] : tray
        .filter((entry) => entry.pinned)
        .map((entry) => entry.ref),
      purpose: request.contextPurpose ?? "解释所选内容",
      describeSetting: (key) =>
        describeObjectSetting(key, latest.current.getSettings()),
    });
  }
  async function ask(
    question: string,
    refs = tray.map((item) => item.ref),
    signal?: AbortSignal,
    updateWorkbench = true,
  ) {
    if (!question.trim() || refs.length === 0)
      throw new Error("请加入内容并输入问题。");
    const api = latest.current.getApi();
    const capability = await api.listCapabilities();
    if (
      !capability.ok ||
      !capability.data.some((c) => c.actionId === "context.resolve")
    )
      throw new Error("当前服务不支持所选内容，请更新服务后重试。");
    if (signal?.aborted || !active()) throw new Error("提问已取消。");
    const materialized: ContextRef[] = [];
    for (const ref of refs) {
      const draft =
        "objectId" in ref ? pendingFragments.get(ref.objectId) : undefined;
      if (draft && "objectId" in ref) {
        const [saved] = await repository.captureFragment({
          draft,
          operationId: ref.objectId,
        });
        materialized.push(saved);
        setTray((current) =>
          current.map((item) =>
            "objectId" in item.ref && item.ref.objectId === ref.objectId
              ? { ...item, ref: saved }
              : item,
          ),
        );
      } else materialized.push(ref);
    }
    refs = materialized;
    if (signal?.aborted || !active()) throw new Error("提问已取消。");
    const session = await api.createSession({
      consumer: "frontend",
      principalId: repository.scopeId,
    });
    if (!session.ok) throw new Error(session.error.message);
    const pendingSession = { api, sessionId: session.data.sessionId };
    if (!updateWorkbench) isolatedContextSessions.current.add(session.data.sessionId);
    pending.current.add(pendingSession);
    const cancel = () => {
      void api.closeSession(pendingSession.sessionId);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted || !active()) {
        cancel();
        throw new Error("提问已取消。");
      }
      const run = await api.submitTurn({
        sessionId: session.data.sessionId,
        idempotencyKey: crypto.randomUUID(),
        input: { message: question, mode: "qa" },
        contextRefs: refs,
        contextPurpose: question,
      });
      if (!active() || signal?.aborted) throw new Error("提问已取消。");
      if (!run.ok) throw new Error(run.error.message);
      if (run.data.status !== "completed") {
        const failure = run.data.events.find((e) => e.type === "run.failed");
        throw new Error(
          failure && "message" in failure
            ? failure.message
            : "提问已取消或未完成。",
        );
      }
      const output = run.data.events
        .filter((e) => e.type === "assistant.message")
        .pop();
      if (!output || output.type !== "assistant.message")
        throw new Error("没有可保存的回答。");
      await repository.saveRunRecord(run.data);
      if (!active() || signal?.aborted) throw new Error("提问已取消。");
      if (updateWorkbench) {
        setAnswer({ text: output.message, run: run.data });
        setPreview(run.data.contextSnapshot);
        setTray((current) => current.filter((item) => item.pinned));
      }
      return output.message;
    } finally {
      signal?.removeEventListener("abort", cancel);
      pending.current.delete(pendingSession);
      isolatedContextSessions.current.delete(session.data.sessionId);
      await api.closeSession(session.data.sessionId);
    }
  }
  const abortRef = useRef<AbortController>();
  async function submit(question: string) {
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setAnswer(undefined);
    setStatus("正在回答…");
    try {
      await ask(question, undefined, abort.signal);
      if (active()) setStatus("回答已完成，可保存为产物。");
    } catch (e) {
      if (active()) setStatus(String((e as Error).message));
    } finally {
      if (active()) setBusy(false);
    }
  }
  async function openSource(object: ObjectEnvelope) {
    if (object.kind !== "content.fragment") return;
    const anchor = object.content.payload.anchors[0];
    const source = await repository.get(anchor.sourceRef);
    if (source.kind !== "source.document" || anchor.type !== "pdf") {
      setStatus("来源回答已保留，可在来源详情中阅读。");
      return source;
    }
    const paper = latest.current
      .getPapers()
      .find((p) => p.id === source.content.payload.paperId);
    if (!paper) throw new Error("来源文献不可用，摘录已保留。");
    const currentHash = await documentHash(paper);
    if (anchor.documentHash && anchor.documentHash !== currentHash)
      throw new Error("来源版本已变化，摘录已保留。");
    const fulltext = normalizePaperFulltext(
      await loadUserPaperArtifact({
        artifactKind: "fulltext",
        paperId: paper.id,
      }),
    );
    const fullPage = fulltext?.pages.find(
      (page) => page.page === anchor.page,
    )?.text;
    const resolution = resolveObjectAnchor(anchor, {
      ref: anchor.sourceRef,
      documentHash: currentHash,
      page: anchor.page,
      text: (fullPage ?? "").replace(/\s+/g, " ").trim(),
    });
    latest.current.openEvidence({
      paperId: paper.id,
      page: anchor.page,
      evidenceId: object.objectId,
      quote: resolution.status === "resolved" ? anchor.quote.exact : "",
    });
    setStatus(
      resolution.status === "resolved" ? "已打开来源。" : resolution.reason,
    );
    return source;
  }
  return {
    ...boardFiles,
    repository,
    port,
    opened,
    openLink,
    closeOpened: () => setOpened(undefined),
    captureQuickAsk: async (
      request: import("../features/pdf/pdfQuickAsk").PdfQuickAskRequest,
    ) => {
      if (!request.pageText.trim() || !request.abstractText.trim())
        throw new Error("当前页与摘要尚未就绪，请完成解析后重试。");
      const paper = latest.current
        .getPapers()
        .find((p) => p.id === request.paper.id);
      if (!paper || request.signal.aborted)
        throw new Error("来源不可用或提问已取消。");
      const hash = await documentHash(paper);
      const source = await repository.projectLegacy(`paper-${paper.id}`, {
        kind: "source.document",
        title: paper.title,
        content: {
          schema: "liteasy.source-document/v1",
          payload: {
            paperId: paper.id,
            literatureId: paper.literature?.literatureId,
            documentHash: hash,
            text: paper.title,
            availability: "local",
            legacyKey: paper.id,
            pages: [{ page: request.page, text: request.pageText }],
            abstractText: request.abstractText,
          },
        },
      });
      const sourceRef = refOf(source);
      const refs = await repository.captureFragment({
        operationId: crypto.randomUUID(),
        draft: {
          kind: "content.fragment",
          title: `${paper.title} · 第 ${request.page} 页`,
          sourceRefs: [sourceRef],
          content: {
            schema: "liteasy.fragment/v1",
            payload: {
              text: request.excerpt,
              partial: false,
              anchors: [
                {
                  type: "pdf",
                  sourceRef,
                  documentHash: hash,
                  page: request.page,
                  quote: { exact: request.excerpt, prefix: "", suffix: "" },
                  rects: [],
                  extractor: "liteasy.pdf-text/v1",
                  normalization: "liteasy.whitespace/v1",
                  precision: hash ? "exact" : "page",
                },
              ],
            },
          },
        },
      });
      return [
        ...refs,
        { ...sourceRef, selectorId: `page:${request.page}` },
        { ...sourceRef, selectorId: "abstract" },
      ];
    },
    importLegacyArtifacts: () =>
      perform(async () => {
        const results = (await latest.current.listLegacyArtifacts?.()) ?? [];
        for (const result of results) {
          if (
            result.version !== "liteasy.agent-artifact/v1" ||
            result.agent.status !== "completed"
          )
            continue;
          const sourceRefs: ObjectRef[] = [];
          for (const reference of result.papers) {
            const paper = latest.current
              .getPapers()
              .find((p) => p.id === reference.id);
            const source = await repository.projectLegacy(
              `paper-${reference.id}`,
              {
                kind: "source.document",
                title: paper?.title ?? reference.title,
                content: {
                  schema: "liteasy.source-document/v1",
                  payload: {
                    paperId: reference.id,
                    legacyKey: reference.id,
                    literatureId: paper?.literature?.literatureId,
                    documentHash: paper ? await documentHash(paper) : undefined,
                    text: paper?.title ?? reference.title,
                    availability: paper ? "local" : "unavailable",
                  },
                },
              },
            );
            sourceRefs.push(refOf(source));
          }
          await repository.projectLegacy(`artifact-${result.artifactId}`, {
            title: result.title,
            kind: "artifact.document",
            runId: result.agent.runId,
            sourceRefs,
            content: {
              schema: "liteasy.document/v1",
              payload: {
                legacyArtifactId: result.artifactId,
                blocks: [
                  {
                    blockId: `legacy-${result.artifactId}`,
                    type: "markdown",
                    text: result.answer,
                    sourceRefs,
                  },
                ],
              },
            },
          });
        }
      }),
    visible,
    setVisible: (next: boolean) => (next ? setVisible(true) : close()),
    objects,
    board,
    placements,
    tray,
    preview,
    answer,
    status,
    busy,
    setStatus,
    refresh,
    perform,
    resolveContext,
    ask,
    submit,
    addToTray,
    cancel: () => abortRef.current?.abort(),
    setTray: (
      update: import("react").SetStateAction<
        Array<{ ref: ContextRef; pinned: boolean }>
      >,
    ) => {
      setTray(update);
      setPreview(undefined);
    },
    contextTitle: (ref: ContextRef) =>
      "objectId" in ref
        ? (pendingFragments.get(ref.objectId)?.title ??
          objects.find((object) => object.objectId === ref.objectId)?.title ??
          "已保存内容")
        : ref.type === "setting"
          ? "设置说明"
          : "错误说明",
    previewContext: async () => {
      try {
        const snapshot: ContextSnapshot = {
          snapshotId: crypto.randomUUID(),
          scopeId: repository.scopeId,
          purpose: "预览",
          createdAt: new Date().toISOString(),
          entries: [],
          tokens: 0,
        };
        for (const item of tray) {
          const draft =
            "objectId" in item.ref
              ? pendingFragments.get(item.ref.objectId)
              : undefined;
          if (draft) {
            const text = draft.content.payload.text;
            const tokens = Math.ceil(new TextEncoder().encode(text).length / 3);
            snapshot.entries.push({
              ref: item.ref,
              title: draft.title,
              text,
              tokens,
              sha256: await hashText(text),
              origin: item.pinned ? "pinned" : "explicit",
              trustLabel: draft.content.payload.anchors.some(
                (anchor) => anchor.type === "text",
              )
                ? "derived"
                : "source",
              extractor: "liteasy.text/v1",
            });
            snapshot.tokens += tokens;
          } else {
            const resolved = await resolveContextSnapshot({
              repository,
              refs: [item.ref],
              purpose: "预览",
              persist: false,
              describeSetting: (key) =>
                describeObjectSetting(key, latest.current.getSettings()),
            });
            snapshot.entries.push(
              ...resolved.entries.map((entry) => ({
                ...entry,
                origin: item.pinned
                  ? ("pinned" as const)
                  : ("explicit" as const),
              })),
            );
            snapshot.tokens += resolved.tokens;
          }
        }
        if (snapshot.tokens > 6000)
          throw new Error("所选内容超出本轮预算，请移除部分内容或分段提问。");
        if (active()) setPreview(snapshot);
      } catch (e) {
        if (active()) setStatus((e as Error).message);
      }
    },
    selectBoard,
    connect: (from: Placement, fromSide: BoardSide, to: Placement, toSide: BoardSide) =>
      perform(async () => {
        const current = boardRef.current;
        if (!current) throw new Error("白板已关闭。");
        return repository.connectPlacements({ boardRef: refOf(current),
          from: { placementId: from.placementId, revision: from.revision, side: fromSide },
          to: { placementId: to.placementId, revision: to.revision, side: toSide },
          operationId: crypto.randomUUID() });
      }, true),
    removeConnection: (edgeId: string) => perform(async () => {
      const current = boardRef.current;
      if (!current) throw new Error("白板已关闭。");
      return repository.removeConnection(refOf(current), edgeId);
    }, true),
    createBoard: (title: string) =>
      perform(async () => {
        const object = await repository.create({
          title,
          kind: "workspace.board",
          content: { schema: "liteasy.board/v1", payload: { description: "" } },
        });
        boardRef.current = object;
      }),
    createNote: (text: string) =>
      perform(async () => {
        const board = await ensureBoard();
        return repository.createAndPlace({
          operationId: crypto.randomUUID(),
          boardRef: refOf(board),
          draft: {
            kind: "content.note",
            title: text.slice(0, 40) || "笔记",
            content: {
              schema: "liteasy.note/v1",
              payload: { text, origin: "user" },
            },
          },
        });
      }),
    place: (refs: ObjectRef[]) =>
      perform(async () => {
        const board = await ensureBoard();
        await repository.applyBoardPatch({
          boardRef: refOf(board),
          operationId: crypto.randomUUID(),
          add: refs,
        });
      }),
    removePlacement: (placementId: string) =>
      perform(async () => {
        const board = await ensureBoard();
        await repository.applyBoardPatch({
          boardRef: refOf(board),
          operationId: crypto.randomUUID(),
          remove: [placementId],
        });
      }),
    move: (p: Placement, position: Placement["position"]) =>
      perform(async () => {
        const board = boardRef.current;
        if (!board) return;
        await repository.applyBoardPatch({
          boardRef: refOf(board),
          operationId: crypto.randomUUID(),
          move: [
            { placementId: p.placementId, revision: p.revision, position },
          ],
        });
      }),
    resize: (p: Placement, geometry: Pick<Placement, "position" | "size">) =>
      perform(async () => {
        const board = boardRef.current;
        if (!board) throw new Error("白板已关闭或不可用。");
        return repository.applyBoardPatch({
          boardRef: refOf(board),
          operationId: crypto.randomUUID(),
          resize: [
            { placementId: p.placementId, revision: p.revision, ...geometry },
          ],
        });
      }, true),
    editPlacement: (p: Placement, text: string) =>
      perform(async () => {
        const board = boardRef.current;
        if (!board) throw new Error("白板已关闭或不可用。");
        return repository.editPlacement({
          boardRef: refOf(board),
          placement: p,
          text,
          operationId: crypto.randomUUID(),
        });
      }, true),
    drop: async (data: DataTransfer) => {
      const ticket = data.getData(PENDING_CAPTURE_MIME);
      const transfer = readObjectTransfer(data);
      const text = data.getData("text/plain");
      const file = Array.from(data.files ?? []).find((file) =>
        file.type.startsWith("image/"),
      );
      await perform(async () => {
        if (ticket) {
          const refs = await tickets.consume(ticket);
          const target = await ensureBoard();
          await repository.applyBoardPatch({
            boardRef: refOf(target), operationId: `${ticket}-place`, add: refs,
          });
          return;
        }
        const board = await ensureBoard();
        if (transfer) {
          const refs =
            transfer.mode === "copy"
              ? await Promise.all(
                  transfer.refs.map(async (ref, index) =>
                    refOf(
                      await repository.copy(
                        ref,
                        `${transfer.transferId}-copy-${index}`,
                      ),
                    ),
                  ),
                )
              : transfer.refs;
          await repository.applyBoardPatch({
            boardRef: refOf(board),
            operationId: transfer.transferId,
            add: refs,
          });
        } else if (file) {
          const asset = await stageImage(
            new Uint8Array(await file.arrayBuffer()),
            file.type,
          );
          await repository.createAndPlace({
            boardRef: refOf(board),
            operationId: crypto.randomUUID(),
            assets: [asset],
            draft: {
              kind: "content.note",
              title: file.name || "粘贴的图片",
              assets: [assetDescriptor(asset)],
              content: {
                schema: "liteasy.note/v1",
                payload: {
                  text: "",
                  origin: "external",
                  assetIds: [asset.assetId],
                },
              },
            },
          });
        } else if (text.trim()) {
          await repository.createAndPlace({
            boardRef: refOf(board),
            operationId: crypto.randomUUID(),
            draft: {
              kind: "content.note",
              title: text.slice(0, 40),
              content: {
                schema: "liteasy.note/v1",
                payload: { text, origin: "external" },
              },
            },
          });
        } else throw new Error("请拖入摘录或粘贴文字。");
      });
    },
    saveAnswer: () =>
      perform(async () => {
        if (!answer || answer.run.status !== "completed")
          throw new Error("回答尚未完成。");
        const refs =
          answer.run.contextRefs?.filter(
            (ref): ref is ObjectRef => "objectId" in ref,
          ) ?? [];
        return repository.create(
          {
            title: answer.run.input.message.slice(0, 80),
            kind: "artifact.document",
            runId: answer.run.runId,
            contextSnapshotId: answer.run.contextSnapshotId,
            sourceRefs: refs,
            content: {
              schema: "liteasy.document/v1",
              payload: {
                blocks: [
                  {
                    blockId: `answer-${answer.run.runId}`,
                    type: "markdown",
                    text: answer.text,
                    sourceRefs: refs,
                  },
                ],
              },
            },
          },
          `save-answer-${answer.run.runId}`,
        );
      }),
    openSource,
  };
}
export type ObjectWorkbenchController = ReturnType<
  typeof useObjectWorkbenchController
>;
