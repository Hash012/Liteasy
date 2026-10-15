import { catalogSearchMetadata } from "../features/search/searchMetadata";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";
import { useMemo, useRef } from "react";
import type { AssistantComposerSuggestion } from "../features/assistant/assistant.types";
import { createResourceReferenceService } from "../features/resource-links/resourceReferenceService";
import type { ResourceReferences } from "../features/resource-links/ResourceReferencesContext";
import { referenceFragment } from "../features/resource-links/referenceText";
import type { AgentAssetService } from "../features/resource-filesystem/agentAssetService";
import { liteasyPath, parseLiteasyPath } from "../features/resource-filesystem/liteasyPath";
import { refOf } from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { Paper } from "../features/workspace/workspace.types";
import { subscribeObjectStorage } from "../features/objects/objectStorage";
import { subscribeNoteFiles } from "../features/note-files/noteFileService";
import { hashText } from "../features/context/objectContext";
import { createPreviewResourceCache } from "../features/resource-links/previewResource";
import { resolveReferencePdf } from "../features/resource-links/referencePdfSource";
import { useContextPickerCatalog, type ContextPickerSources } from "./useContextPickerCatalog";

export function useResourceLinksController(input: { repository: ObjectRepository; assets: AgentAssetService;
  entries?: ReadingCatalogEntry[];
  pickerSources?: ContextPickerSources;
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  capturePaperFulltext?: (paperIds: string[]) => Promise<import("../features/objects/object.types").ObjectRef[]>;
  suggestions: AssistantComposerSuggestion[]; papers: Paper[]; open(path: string): void | Promise<unknown> }) {
  const latest = useRef(input); latest.current = input;
  const scope = input.repository.scopeId;
  const suggestions = useMemo(() => [...input.suggestions.filter((item) => item.resourcePath), ...input.papers.map((paper): AssistantComposerSuggestion => ({
    searchMetadata: catalogSearchMetadata(input.entries?.find((entry) => entry.id === paper.id) ?? { id: paper.id, title: paper.title, format: "pdf", subjects: paper.literature?.subjects }),
    id: `paper-${paper.id}`, trigger: "@", label: paper.literature?.title || paper.title, category: "论文", detail: "PDF 文献",
    resourcePath: liteasyPath(scope, { kind: "paper", paperId: paper.id }),
    resolveToken: async () => { const attachments = await latest.current.assets.context(liteasyPath(scope, { kind: "paper", paperId: paper.id }));
      return { id: `paper-${paper.id}`, kind: "object", label: paper.title, prompt: "", contextRefs: attachments.flatMap((item) => item.refs) }; },
  }))], [input.entries, input.suggestions, input.papers, scope]);
  const catalog = useRef(suggestions); catalog.current = suggestions;
  const picker = useContextPickerCatalog({ ...input.pickerSources, scope, entries: input.entries, suggestions });
  const pdfBytes = useMemo(() => createPreviewResourceCache<Uint8Array>(3, 64 * 1024 * 1024, bytes => bytes.byteLength), [scope]);
  const service = useMemo(() => createResourceReferenceService({ scope, assets: input.assets,
    active: () => latest.current.repository.scopeId === scope,
    async loadPdf(path, signal, intent, member) {
      const current = latest.current;
      if (!current.loadPdfSource) return undefined;
      const source = await resolveReferencePdf({ path, repository: current.repository, papers: current.papers, signal, intent, member });
      if (!source) return undefined;
      signal.throwIfAborted();
      const lease = pdfBytes.acquire(source.target.documentKey, async readSignal => {
        const bytes = await current.loadPdfSource!(source.paper.sourcePath!);
        readSignal.throwIfAborted();
        if (/^[a-f0-9]{64}$/i.test(source.paper.contentHash ?? "")) {
          const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
          const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
          if (actual !== source.paper.contentHash!.toLowerCase()) throw new Error("原始 PDF 文件内容已变化，请重新导入后选择来源。");
        }
        return bytes;
      }, signal);
      let bytes: Uint8Array;
      try { bytes = await lease.promise; } finally { lease.release(); }
      signal.throwIfAborted();
      if (latest.current.repository.scopeId !== scope) throw new Error("账号已切换，请重新选择引用。");
      return { bytes, page: source.page, path: source.path, documentKey: source.target.documentKey, target: source.target };
    },
    catalog: () => catalog.current.map((item) => ({ path: item.resourcePath!, title: item.label, detail: item.detail, kind: item.category })),
    subscribe(path, changed) {
      try {
        const target = parseLiteasyPath(path, scope);
        if (target.kind === "object" && target.followLatest) return subscribeObjectStorage(scope, (keys) => { if (!keys || keys.includes(`head/${target.ref.objectId}`)) changed(); });
        if (target.kind === "external-file") return subscribeNoteFiles(scope, (change) => {
          if (change.kind === "file" && change.entry.mountId === target.mountId && change.entry.path === target.path || change.kind === "mount" && change.mount.id === target.mountId || change.kind === "directory" && change.mountId === target.mountId) changed();
        });
      } catch { /* Registered asset adapters may use their own path shape. Reads still check scope. */ }
      return () => {};
    },
  }), [scope, input.assets]);
  return useMemo<ResourceReferences>(() => ({ service, suggestions, picker,
    async resolvePickerToken(member) {
      if (latest.current.repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
      if (!member.path) throw new Error("此资产没有可解析的资源路径。");
      let path = member.path;
      const target = parseLiteasyPath(path.split("#")[0], scope);
      if (target.kind === "paper" && member.completeText) {
        const current = latest.current, paper = current.papers.find(paper => paper.id === target.paperId);
        if (!paper?.sourcePath || !current.loadPdfSource || !current.capturePaperFulltext) throw new Error("无法核验完整原文，请打开原文件，或选择已有文字片段。");
        const refs = await current.capturePaperFulltext([target.paperId]);
        const { originalPdfPageCount } = await import("../features/pdf/pdfSourcePageCount");
        const count = await originalPdfPageCount(await current.loadPdfSource(paper.sourcePath));
        const source = refs[0] ? await current.repository.get(refs[0]) : undefined;
        const pages = source?.kind === "source.document" ? new Set(source.content.payload.pages?.map(page => page.page)) : new Set<number>();
        if (pages.size !== count || Array.from({ length: count }, (_, index) => index + 1).some(page => !pages.has(page))) throw new Error("原文尚未完整解析，不能按全文加入。请完成解析或明确选择已有片段。");
        if (latest.current.repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
        return { id: member.id, kind: "object", label: paper.title, prompt: "", detail: `全文文本 · ${count} 页`, requireCompleteContext: true, resourcePath: path, contextRefs: refs };
      }
      if (target.kind === "object" && member.revision) path = liteasyPath(scope, { kind: "object", ref: { ...target.ref, revision: member.revision } });
      const attachments = await latest.current.assets.context(path);
      if (latest.current.repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
      if (!attachments.length) throw new Error("此资产暂不可加入上下文。");
      return { id: member.id, kind: "object", label: attachments[0].title, prompt: "", resourcePath: path, contextRefs: attachments.flatMap(item => item.refs) };
    },
    open: async (path) => { await latest.current.open(path); },
    async capture(document, range) {
      await service.verify(document);
      const selected = referenceFragment(document.text, range.fragment, document.complete);
      if (!range.text.trim() || selected.text !== range.text || range.text.length > 80000) throw new Error("选区已失效，请重新选择文字。");
      const start = selected.offsets?.start ?? document.text.split("\n").slice(0, selected.start - 1).reduce((total, line) => total + line.length + 1, 0);
      const end = start + selected.text.length;
      const repository = latest.current.repository;
      if (repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
      let parsed;
      try { parsed = parseLiteasyPath(document.asset.path, scope); } catch { /* A registered adapter can supply its own resource locator. */ }
      const snapshotKey = `reference:${await hashText(JSON.stringify([scope, document.asset.path, document.asset.revision, document.text]))}`;
      const source = parsed?.kind === "object" && document.asset.revision && !document.source && !parsed.ref.selectorId
        ? await repository.get({ objectId: parsed.ref.objectId, revision: document.asset.revision })
        : await repository.create({ kind: "source.document", sourceRefs: parsed?.kind === "object" && document.asset.revision ? [{ ...parsed.ref, revision: document.asset.revision }] : undefined, sourceReferences: document.asset.sourceReferences, sourceResolution: document.asset.sourceResolution, title: `${document.asset.title}（引用时快照）`,
          content: { schema: "liteasy.source-document/v1", payload: { paperId: document.source?.paperId ?? snapshotKey, documentHash: document.source?.documentHash, pages: document.source?.pages.map(({ page, text }) => ({ page, text })), availability: "local", text: document.text,
            legacyKey: snapshotKey,
            abstractText: [`来源：${document.asset.path}`, `读取版本：${document.asset.revision ?? "内容快照"}`,
              document.complete ? "完整读取。" : "选取时已载入的部分正文，不代表全文。"].join("\n") } } }, snapshotKey);
      const page = document.source?.pages.find((page) => start >= page.start && end <= page.end);
      const selectionKey = `reference-selection:${await hashText(JSON.stringify([scope, refOf(source), start, end, range.text]))}`;
      const object = await repository.create({ kind: "content.fragment", title: `${source.title} · 第 ${selected.start}–${selected.end} 行`,
        sourceReferences: document.asset.sourceReferences, sourceResolution: document.asset.sourceResolution,
        sourceRefs: [refOf(source)], content: { schema: "liteasy.fragment/v1", payload: { text: range.text, partial: true,
          anchors: [...(page ? [{ type: "pdf" as const, sourceRef: refOf(source), documentHash: document.source?.documentHash, page: page.page, rects: [], precision: "page" as const, extractor: "cached-text", normalization: "lf-utf16", quote: { exact: range.text, prefix: "", suffix: "" } }] : []), { type: "text", sourceRef: refOf(source), blockId: `C${start}:${end}`,
            normalization: "lf-utf16", range: { start, end }, quote: { exact: range.text, prefix: document.text.slice(Math.max(0, start - 48), start), suffix: document.text.slice(end, end + 48) } }] } } }, selectionKey);
      if (latest.current.repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
      return { id: `reference-${object.objectId}`, kind: "object", label: object.title, prompt: "", detail: `第 ${range.start}–${range.end} 行 · 已固定引用内容`, contextRefs: [refOf(object)] };
    },
  }), [service, suggestions, scope, picker]);
}
