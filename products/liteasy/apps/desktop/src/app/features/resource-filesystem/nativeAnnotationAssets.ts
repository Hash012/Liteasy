import { loadPdfNotes } from "../notes/pdfNotesSource";
import { artifactAnnotationNotes } from "../notes/artifactNotesSource";
import type { NotesItem } from "../notes/notes.types";
import type { WorkspaceAgentAssetInput } from "./workspaceAgentAssetService";
import { AgentAssetError, type AgentAsset, type AgentAssetAdapter } from "./agentAsset.types";
import { readAgentAssetText } from "./agentAssetService";
import { liteasyPath, parseLiteasyPath } from "./liteasyPath";
import { canonicalResourceJson, resourceContentRevision } from "./resourceFileContent";

/** Native annotations keep their original domain identity. Only explicit context capture creates a snapshot. */
export function nativeAnnotationAssets(input: WorkspaceAgentAssetInput): AgentAssetAdapter[] {
  const scopeId = input.repository.scopeId;
  const check = (signal?: AbortSignal) => { signal?.throwIfAborted(); if (!input.active()) throw new AgentAssetError("scope_changed", "账号已切换，请重新选择批注。"); };
  return (["paper-annotations", "artifact-annotations"] as const).map(host => {
    async function find(path: string): Promise<NotesItem> {
      check();
      const target = parseLiteasyPath(path, scopeId);
      let item: NotesItem | undefined;
      if (target.kind === "pdf-annotation") {
        const paper = input.getPapers?.().find(paper => paper.id === target.paperId);
        if (!paper) throw new AgentAssetError("not_found", "这篇文献已移除，请重新关联原始 PDF。");
        item = (await loadPdfNotes([paper], () => { throw new AgentAssetError("transient_failure", "批注暂时无法读取，请重试。"); }))
          .find(item => item.annotation?.id === target.annotationId);
      } else if (target.kind === "artifact-annotation") {
        item = artifactAnnotationNotes(await input.getArtifacts?.() ?? []).find(item => item.target.kind === "artifact-annotation" &&
          item.target.artifactId === target.artifactId && item.target.annotationId === target.annotationId);
      }
      check();
      if (!item) throw new AgentAssetError("not_found", "这条批注已删除或不在当前账号中，请打开原文件查看。");
      return item;
    }
    async function describe(path: string, item: NotesItem): Promise<AgentAsset> {
      return { path, title: item.title, kind: host === "paper-annotations" ? "pdf.annotation" : "artifact.annotation",
        revision: await resourceContentRevision(canonicalResourceJson({ text: item.text, annotation: item.annotation, anchors: item.paperAnchors, updatedAt: item.updatedAt })),
        capabilities: ["read", ...(input.resolveContext ? ["add_context" as const] : [])] };
    }
    const adapter: AgentAssetAdapter = { id: host, scopeId, accepts: path => new URL(path).hostname === host,
      // Notes/catalog already own discovery; do not scan every document on each omnibox query.
      search: async () => [],
      async stat(path, options) { check(options?.signal); const item = await find(path); const asset = await describe(path, item); check(options?.signal); return asset; },
      async read(path, options) {
        check(options.signal); const item = await find(path), asset = await describe(path, item);
        const quote = item.annotation?.excerpt;
        const text = quote && item.annotation?.note?.trim() ? `${item.text}\n\n### 原文引述\n\n${quote}` : item.text;
        const annotation = item.annotation;
        const userContext = annotation ? { text: [!annotation.aiGuide ? annotation.note?.trim() : "", !annotation.aiGuide && ["text", "note"].includes(annotation.kind) ? annotation.text?.trim() : "", annotation.quickAsk?.question?.trim(), `引用：${annotation.excerpt}`].filter(Boolean).join("\n"), representationId: "annotation-user-context/v1" } : undefined;
        check(options.signal); return { ...readAgentAssetText(asset, text, options, { kind: "user", coverage: "partial" }), userContext };
      },
      async present(path, options) {
        const item = await find(path), asset = await describe(path, item);
        if (options.intent === "source") {
          if (item.annotation && item.paper) return { kind: "pdf", asset, path: `${path}#page=${item.annotation.page}`, intent: "source" };
          const origins = [...new Map((item.paperAnchors ?? []).filter(anchor => anchor.locator.page).map(anchor => [`${anchor.source.paperId}:${anchor.locator.page}`, anchor])).values()];
          if (origins.length === 1) return { kind: "pdf", asset, path: `${liteasyPath(scopeId, { kind: "paper", paperId: origins[0].source.paperId })}#page=${origins[0].locator.page}`, intent: "source" };
          return { kind: "unavailable", asset, code: "not_supported", message: "此批注没有唯一的 PDF 来源位置，请打开所属产物选择具体引文。", retryable: false };
        }
        const read = await adapter.read(path, options);
        return { kind: "content", asset: read.asset, read: { ...read, content: read.content! } };
      },
      context: input.resolveContext ? path => input.resolveContext!(path) : undefined,
    };
    return adapter;
  });
}
