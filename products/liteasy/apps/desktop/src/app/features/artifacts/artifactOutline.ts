import type { CompletedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { Paper } from "../workspace/workspace.types";
import type { ArtifactOutlineNode } from "./artifact.types";

function safeNodePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
}

export function buildArtifactOutline(input: {
  analysis: CompletedMultiPaperAnalysis;
  papers: Paper[];
  title: string;
}): ArtifactOutlineNode[] {
  const nodes: ArtifactOutlineNode[] = [
    { id: "root", kind: "root", label: input.title }
  ];

  input.papers.forEach((paper) => {
    const paperNodeId = `paper-${safeNodePart(paper.id)}`;
    nodes.push({
      id: paperNodeId,
      kind: "paper",
      label: paper.title,
      parentId: "root"
    });
    const paperEvidence = input.analysis.evidence.filter(
      (evidence) => evidence.paperId === paper.id
    );
    if (paperEvidence.length > 0) {
      const termSectionId = `terms-${safeNodePart(paper.id)}`;
      nodes.push({
        id: termSectionId,
        kind: "section",
        label: "关键名词与概念",
        parentId: paperNodeId
      });
      const termEvidenceIds = new Map<string, Set<string>>();
      paperEvidence.forEach((evidence) => {
        (evidence.terms ?? []).forEach((term) => {
          const ids = termEvidenceIds.get(term) ?? new Set<string>();
          ids.add(evidence.id);
          termEvidenceIds.set(term, ids);
        });
      });
      [...termEvidenceIds.entries()].forEach(([term, evidenceIds], index) => {
        nodes.push({
          evidenceIds: [...evidenceIds],
          id: `term-${safeNodePart(paper.id)}-${index}`,
          kind: "term",
          label: term,
          parentId: termSectionId
        });
      });

      const evidenceSectionId = `evidence-section-${safeNodePart(paper.id)}`;
      nodes.push({
        id: evidenceSectionId,
        kind: "section",
        label: "证据摘要",
        parentId: paperNodeId
      });
      paperEvidence.forEach((evidence) => {
        nodes.push({
          evidenceIds: [evidence.id],
          id: `outline-${safeNodePart(evidence.id)}`,
          kind: "evidence",
          label: evidence.summary || evidence.quote,
          parentId: evidenceSectionId
        });
      });
    }

    if (input.analysis.run.coverage.missingPaperIds.includes(paper.id)) {
      nodes.push({
        id: `gap-${safeNodePart(paper.id)}`,
        kind: "gap",
        label: "当前没有取得可引用证据",
        parentId: paperNodeId
      });
    }
  });

  return nodes;
}

export function outlineToMarkdown(nodes: ArtifactOutlineNode[]) {
  const byParent = new Map<string | undefined, ArtifactOutlineNode[]>();
  nodes.forEach((node) => {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  });
  const lines: string[] = [];

  function append(node: ArtifactOutlineNode, depth: number) {
    const evidenceSuffix = node.evidenceIds?.length
      ? ` <!-- evidence:${node.evidenceIds.join(",")} -->`
      : "";
    lines.push(`${"  ".repeat(depth)}- ${node.label}${evidenceSuffix}`);
    (byParent.get(node.id) ?? []).forEach((child) => append(child, depth + 1));
  }

  (byParent.get(undefined) ?? []).forEach((root) => append(root, 0));
  return `${lines.join("\n")}\n`;
}

export function parseStreamingOutlineMarkdown(markdown: string): ArtifactOutlineNode[] {
  const nodes: ArtifactOutlineNode[] = [];
  const parentAtDepth = new Map<number, string>();
  markdown.split(/\r?\n/).forEach((line, lineIndex) => {
    const match = line.match(/^(\s*)[-*+]\s+(.+?)\s*$/);
    if (!match) {
      return;
    }
    const depth = Math.floor(match[1].replace(/\t/g, "  ").length / 2);
    const evidenceMatch = match[2].match(/<!--\s*evidence:([^>]+)-->/i);
    const bracketEvidenceIds = [...match[2].matchAll(/\[(evidence-[^\]\s]+)\]/gi)]
      .map((evidenceIdMatch) => evidenceIdMatch[1]);
    const label = match[2].replace(/<!--\s*evidence:[^>]+-->/gi, "").trim();
    if (!label) {
      return;
    }
    const id = `stream-node-${lineIndex}`;
    nodes.push({
      evidenceIds: evidenceMatch
        ? evidenceMatch[1].split(",").map((idPart) => idPart.trim()).filter(Boolean)
        : bracketEvidenceIds.length > 0
          ? bracketEvidenceIds
          : undefined,
      id,
      kind: depth === 0 ? "root" : depth === 1 ? "section" : "term",
      label,
      parentId: depth > 0 ? parentAtDepth.get(depth - 1) : undefined
    });
    parentAtDepth.set(depth, id);
    [...parentAtDepth.keys()].forEach((storedDepth) => {
      if (storedDepth > depth) {
        parentAtDepth.delete(storedDepth);
      }
    });
  });
  return nodes;
}
