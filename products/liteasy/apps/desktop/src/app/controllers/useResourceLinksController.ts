import { catalogSearchMetadata } from "../features/search/searchMetadata";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";
import { useMemo, useRef } from "react";
import type { AssistantComposerSuggestion } from "../features/assistant/assistant.types";
import { createResourceReferenceService } from "../features/resource-links/resourceReferenceService";
import type { ResourceReferences } from "../features/resource-links/ResourceReferencesContext";
import { referenceLines } from "../features/resource-links/referenceText";
import type { AgentAssetService } from "../features/resource-filesystem/agentAssetService";
import { liteasyPath, parseLiteasyPath } from "../features/resource-filesystem/liteasyPath";
import { refOf } from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { Paper } from "../features/workspace/workspace.types";
import { subscribeObjectStorage } from "../features/objects/objectStorage";
import { subscribeNoteFiles } from "../features/note-files/noteFileService";
import { hashText } from "../features/context/objectContext";

export function useResourceLinksController(input: { repository: ObjectRepository; assets: AgentAssetService;
  entries?: ReadingCatalogEntry[];
  suggestions: AssistantComposerSuggestion[]; papers: Paper[]; open(path: string): void | Promise<unknown> }) {
  const latest = useRef(input); latest.current = input;
  const scope = input.repository.scopeId;
  const suggestions = useMemo(() => [...input.suggestions.filter((item) => item.resourcePath), ...input.papers.map((paper): AssistantComposerSuggestion => ({
    searchMetadata: catalogSearchMetadata(input.entries?.find((entry) => entry.id === paper.id) ?? { id: paper.id, title: paper.title, format: "pdf", subjects: paper.literature?.subjects }),
    id: `paper-${paper.id}`, trigger: "@", label: paper.literature?.title || paper.title, category: "论文", detail: paper.sourcePath,
    resourcePath: liteasyPath(scope, { kind: "paper", paperId: paper.id }),
    resolveToken: async () => { const attachments = await latest.current.assets.context(liteasyPath(scope, { kind: "paper", paperId: paper.id }));
      return { id: `paper-${paper.id}`, kind: "object", label: paper.title, prompt: "", contextRefs: attachments.flatMap((item) => item.refs) }; },
  }))], [input.entries, input.suggestions, input.papers, scope]);
  const catalog = useRef(suggestions); catalog.current = suggestions;
  const service = useMemo(() => createResourceReferenceService({ scope, assets: input.assets,
    active: () => latest.current.repository.scopeId === scope,
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
  return useMemo<ResourceReferences>(() => ({ service, suggestions,
    open: async (path) => { await latest.current.open(path); },
    async capture(document, range) {
      await service.verify(document);
      const selected = referenceLines(document.text, range.start, range.end, document.complete);
      if (!range.text.trim() || !selected.text.includes(range.text) || range.text.length > 80000) throw new Error("选区已失效，请重新选择文字。");
      const repository = latest.current.repository;
      if (repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
      let parsed;
      try { parsed = parseLiteasyPath(document.asset.path, scope); } catch { /* A registered adapter can supply its own resource locator. */ }
      const snapshotKey = `reference:${await hashText(JSON.stringify([scope, document.asset.path, document.asset.revision, document.text]))}`;
      const source = parsed?.kind === "object" && document.asset.revision
        ? await repository.get({ objectId: parsed.ref.objectId, revision: document.asset.revision })
        : await repository.create({ kind: "source.document", sourceReferences: document.asset.sourceReferences, sourceResolution: document.asset.sourceResolution, title: `${document.asset.title}（引用时快照）`,
          content: { schema: "liteasy.source-document/v1", payload: { paperId: snapshotKey, availability: "local", text: document.text,
            legacyKey: snapshotKey,
            abstractText: [`来源：${document.asset.path}`, `读取版本：${document.asset.revision ?? "内容快照"}`,
              document.complete ? "完整读取。" : "选取时已载入的部分正文，不代表全文。"].join("\n") } } });
      const object = await repository.create({ kind: "content.fragment", title: `${document.asset.title} · ${range.label}`,
        sourceRefs: [refOf(source)], content: { schema: "liteasy.fragment/v1", payload: { text: range.text, partial: true,
          anchors: [{ type: "text", sourceRef: refOf(source), blockId: `L${range.start}:${range.end}`,
            quote: { exact: range.text, prefix: "", suffix: "" } }] } } });
      if (latest.current.repository.scopeId !== scope) throw new Error("账号已切换，请重新选择。");
      return { id: `reference-${object.objectId}`, kind: "object", label: object.title, prompt: "", detail: `第 ${range.start}–${range.end} 行 · 已固定引用内容`, contextRefs: [refOf(object)] };
    },
  }), [service, suggestions, scope]);
}
