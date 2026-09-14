import type { AgentArtifactResult } from "./artifact.types";

/** Keep the generated document body, including deeper pages, in fixed chat context. */
export function artifactContextText(artifact: AgentArtifactResult) {
  const document = artifact.thinReadingDocument;
  if (!document) return artifact.answer?.trim() || artifact.outlineMarkdown?.trim() || "";
  const nodes = Object.values(document.nodes).filter((node) => node.summary?.trim());
  if (!nodes.length) return artifact.answer?.trim() || "";
  return [
    `# ${artifact.title}`,
    artifact.papers.length ? `来源论文：${artifact.papers.map((paper) => paper.title).join("；")}` : "",
    ...nodes.map((node) => [
      `## ${node.title}`, node.summary,
      ...(node.evidence.paperEvidenceSpans ?? []).map((span: { page?: number; quote: string }) => `> 第 ${span.page ?? "?"} 页：${span.quote}`),
    ].filter(Boolean).join("\n\n")),
  ].filter(Boolean).join("\n\n");
}
