import type { NotesItem } from "../notes/notes.types";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { objectText } from "../objects/object.types";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { formatPaperAnchorText } from "../paper-anchors/paperAnchorEntity";
import { compileDocument } from "./documentCompiler";
import { sha256, stableJson, type ExportOptions } from "./documentExport.types";
export async function compileNoteDocument(item: NotesItem, input: { scopeId?: string; assets?: AgentAssetService; options?: Partial<ExportOptions>; signal?: AbortSignal; active?: () => boolean }) {
  const frozen = structuredClone(item);
  if (frozen.unavailable) throw new Error("笔记来源不可读取。");
  if (frozen.object?.kind === "workspace.board") throw new Error("白板请从工作区导出阅读报告，以固定布局和成员版本。");
  if (input.options?.scope && input.options.scope !== "full_saved") throw new Error("笔记请选择全部已保存内容；摘录需明确选区。");
  const markdown = frozen.file?.text ?? (frozen.object ? objectText(frozen.object) : frozen.text);
  const revision = frozen.object?.revision ?? frozen.file?.version ?? undefined;
  const document = await compileDocument({ ...input, title: frozen.title,
    markdown: formatPaperAnchorText(markdown, frozen.paperAnchors ?? frozen.object?.paperAnchors ?? []),
    basePath: input.scopeId ? liteasyPath(input.scopeId, frozen.target) : undefined,
    sources: [{ identity: frozen.object?.objectId ?? frozen.key, revision, state: revision ? "pinned" : "legacy-unpinned", sha256: await sha256(stableJson(frozen.object ?? { text: markdown, revision })) }] });
  document.scopeId = input.scopeId;
  return document;
}
