import type { ArtifactTab } from "../artifacts/artifact.types";
import { createArtifactSourceMarkdown } from "../artifacts/artifactDocumentExport";
import type { UIDslNode } from "../generative-ui/generativeUi.types";
import { authoredArtifactMarkdown } from "../artifact-workflow/authoredArtifact";
import { paperAnchorsForArtifact } from "../paper-anchors/paperAnchorAdapters";
import { formatPaperAnchorText } from "../paper-anchors/paperAnchorEntity";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { compileDocument } from "./documentCompiler";
import { sha256, stableJson, defaultExportOptions, type ExportOptions, type ExportDiagnostic } from "./documentExport.types";

const literal = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>!|])/g, "\\$1");
function uiDslMarkdown(node: UIDslNode, diagnostics: ExportDiagnostic[], depth = 0): string {
  if (depth > 32) throw new Error("生成式 Canvas 结构过深。");
  const text = (key: string) => typeof node.props[key] === "string" ? literal(node.props[key]) : "";
  const records = (key: string): Record<string, unknown>[] => Array.isArray(node.props[key]) ? node.props[key].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
  const lines = text("title") ? [`### ${text("title")}`, ""] : [];
  switch (node.component) {
    case "ComparisonTable": case "EvidenceMatrix": {
      const keys = node.component === "ComparisonTable" ? ["paper", "focus", "evidence"] : ["paper", "evidence", "snippet"];
      lines.push(`| ${keys.map(key => ({ paper: "文献", focus: "关注点", evidence: "证据", snippet: "摘录" })[key]).join(" | ")} |`, "| --- | --- | --- |", ...records("rows").map(row => `| ${keys.map(key => literal(row[key])).join(" | ")} |`));
      break;
    }
    case "MindMap": case "TreeOutline": {
      const nodes = records("nodes");
      const visited = new Set<string>();
      const visit = (row: Record<string, unknown>, level: number) => {
        const id = String(row.id ?? "");
        if (visited.has(id)) { diagnostics.push({ code: "duplicate_or_cycle", severity: "warning", message: "图结构包含重复或循环节点，已保留一次正文。" }); return; }
        visited.add(id); lines.push(`${"  ".repeat(Math.min(level, 16))}- ${literal(row.label ?? row.title ?? "无标题")}`);
        if (level > 32) throw new Error("图结构过深。");
        nodes.filter(child => child.parentId === id).forEach(child => visit(child, level + 1));
      };
      nodes.filter(row => !row.parentId || !nodes.some(parent => parent.id === row.parentId)).forEach(row => visit(row, 0));
      nodes.filter(row => !visited.has(String(row.id ?? ""))).forEach(row => visit(row, 0));
      break;
    }
    case "SlideDeck": records("slides").forEach(slide => lines.push(`#### ${literal(slide.title)}`, "", typeof slide.markdown === "string" ? slide.markdown : literal(slide.body ?? slide.summary), "")); break;
    case "EvidenceCard": lines.push(text("snippet")); break;
    case "CitationList": records("citations").forEach(row => lines.push(`- ${literal(row.paperTitle)} · 第 ${literal(row.page)} 页：${literal(row.snippet)}`)); break;
    case "StatusBanner": lines.push(text("message")); break;
    case "Panel": case "Stack": break;
    case "ActionBar": case "ArtifactLauncher": diagnostics.push({ code: "interactive_static", severity: "warning", message: "交互控件仅导出静态说明，不执行操作。" }); lines.push("此处为交互入口，阅读报告不执行操作。"); break;
    default: throw new Error("生成式 Canvas 包含未注册静态组件。");
  }
  return [...lines, ...(node.children ?? []).map(child => uiDslMarkdown(child, diagnostics, depth + 1))].join("\n\n");
}
export async function compileArtifactDocument(tab: ArtifactTab, input: { options?: Partial<ExportOptions>; assets?: AgentAssetService; basePath?: string; signal?: AbortSignal; active?: () => boolean } = {}) {
  // Freeze before the first asynchronous operation. This does not invent repository revisions.
  const frozen = structuredClone(tab);
  const options = { ...defaultExportOptions, ...input.options };
  if (options.scope === "excerpt") throw new Error("产物摘录需明确选区；请选择全文或薄读节点。");
  if (options.scope !== "full_saved" && frozen.type !== "thin_reading") throw new Error("此类型暂不支持节点范围导出。");
  if (options.profileId === "spatial-atlas/v1") throw new Error("空间图集仅适用于具有已保存布局的工作区白板。");
  const diagnostics: ExportDiagnostic[] = [];
  let extra = "";
  let authoritative = false;
  if (frozen.authoredArtifact) {
    extra = authoredArtifactMarkdown(frozen.authoredArtifact); authoritative = true;
  } else if (frozen.mindmapArtifact) {
    const seen = new Set<string>();
    const visit = (node: typeof frozen.mindmapArtifact.root, depth: number): string => {
      if (depth > 32) throw new Error("思维导图结构过深。");
      if (seen.has(node.id)) { diagnostics.push({ code: "duplicate_or_cycle", severity: "warning", message: "思维导图包含重复或循环节点，已保留一次。" }); return ""; }
      seen.add(node.id);
      return [`${"#".repeat(Math.min(6, depth + 2))} ${literal(node.label)}`, node.summary ?? "", ...node.children.map(child => visit(child, depth + 1))].join("\n\n");
    };
    extra = visit(frozen.mindmapArtifact.root, 0); authoritative = true;
    extra += "\n\n## 来源与核验\n\n" + frozen.mindmapArtifact.sources.selectedPapers.map(source => `- ${literal(source.paperTitle)}：${literal(source.snippet)}`).join("\n") + `\n\n既有核验状态：${literal(frozen.mindmapArtifact.verification.status)}（导出不重新核验）。\n`;
  } else if (frozen.intuitionGraph) {
    extra = frozen.intuitionGraph.nodes.map(node => `### ${literal(node.label)}\n\n${node.status === "complete" ? node.summary : "尚未生成正文。"}`).join("\n\n");
    const labels = new Map(frozen.intuitionGraph.nodes.map(node => [node.id, node.label]));
    extra += "\n\n## 关系\n\n" + frozen.intuitionGraph.edges.map(edge => `- ${literal(labels.get(edge.sourceNodeId) ?? "缺失节点")} → ${literal(labels.get(edge.targetNodeId) ?? "缺失节点")}：${literal(edge.label ?? edge.kind)}`).join("\n");
    authoritative = true;
  } else if (frozen.uiDsl) {
    if (frozen.uiDsl.dataSources.length) throw new Error("生成式 Canvas 包含尚未冻结的数据绑定，不能将当前界面当作完整来源导出。");
    extra = uiDslMarkdown(frozen.uiDsl.root, diagnostics); authoritative = true;
  }
  if (frozen.type === "thin_reading") {
    if (!frozen.thinReadingDocument) throw new Error("薄读正文缺失，不能生成完整阅读报告。");
    const entries = Object.entries(frozen.thinReadingDocument.nodes);
    const traversed = new Set<string>();
    const checkTree = (id: string, path: Set<string>, depth: number) => {
      if (depth > 64) throw new Error("薄读层级超过导出预算，请按分支拆分导出。");
      if (path.has(id)) { diagnostics.push({ code: "cycle", severity: "warning", message: "薄读包含循环关系，节点正文仅输出一次。" }); return; }
      if (traversed.has(id)) return;
      traversed.add(id);
      const node = frozen.thinReadingDocument!.nodes[id]; if (!node) return;
      for (const child of node.childIds) checkTree(child, new Set(path).add(id), depth + 1);
    };
    checkTree(frozen.thinReadingDocument.rootNodeId, new Set(), 0);
    for (const [id] of entries) checkTree(id, new Set(), 0);
    const children = new Set(entries.flatMap(([, node]) => node.childIds));
    if (entries.some(([id]) => id !== frozen.thinReadingDocument!.rootNodeId && !children.has(id))) diagnostics.push({ code: "orphan_node", severity: "warning", message: "薄读包含未归类的已保存节点，全文导出保留其正文。" });
    if (entries.some(([, node]) => node.childIds.some((id: string) => !frozen.thinReadingDocument!.nodes[id]))) diagnostics.push({ code: "missing_node", severity: "warning", message: "薄读包含尚未生成或缺失的子节点，导出仅包含已保存正文。" });
    if (entries.some(([, node]) => node.visualizations.some((visual: { modality: string }) => visual.modality !== "source_figure"))) diagnostics.push({ code: "visual_static_description", severity: "warning", message: "部分科学可视化尚无固定静态图，保留语义说明及来源，不能替代原生交互产物。" });
  }
  if (!authoritative && frozen.type !== "thin_reading" && !frozen.markdown?.trim() && !frozen.answer?.trim() && !frozen.outlineNodes?.length && !frozen.outlineMarkdown?.trim()) throw new Error("产物没有完整已保存正文，不能用预览代替全文导出。");
  const projection = authoritative ? { ...frozen, outlineNodes: [], outlineMarkdown: "", preview: undefined } : frozen;
  const anchors = paperAnchorsForArtifact(frozen);
  const markdown = createArtifactSourceMarkdown(projection, { ...options, includeExportedAt: false }) + (extra ? `\n\n${formatPaperAnchorText(extra, anchors)}` : "");
  const sourceHash = await sha256(stableJson(frozen));
  const document = await compileDocument({ ...input, title: frozen.title, markdown, options, sources: [{ identity: frozen.artifactId, state: options.draftPolicy === "frozen_draft" ? "draft" : "legacy-unpinned", sha256: sourceHash }] });
  if (options.draftPolicy === "frozen_draft") document.diagnostics.push({ code: "frozen_draft", severity: "warning", message: "本次导出为显式冻结的未保存草稿快照，来源未修改。" });
  document.diagnostics.unshift(...diagnostics);
  return document;
}
