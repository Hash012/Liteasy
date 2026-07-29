import type {
  MindmapArtifact,
  MindmapNode,
  MindmapNodeType,
  MindmapSourceCatalog,
  MindmapVerificationIssue,
  MindmapVerificationReport
} from "./mindmapArtifact.types";

export type VerifyMindmapArtifactOptions = {
  selectedPaperIds: string[];
  now?: () => Date;
};

export function verifyMindmapArtifact(
  artifact: MindmapArtifact,
  options: VerifyMindmapArtifactOptions
): MindmapVerificationReport {
  const sourceRefs = collectSourceRefs(artifact.sources);
  const externalAuthorityByRef = new Map(
    artifact.sources.externalReferences.map((source) => [source.refId, source.authorityLevel])
  );
  const nodes = walkNodes(artifact.root);
  const errors: MindmapVerificationIssue[] = [];

  for (const node of nodes) {
    if (!isStructurallyValidNode(node)) {
      errors.push({
        code: "invalid_structure",
        message: "思维导图节点缺少必要结构字段。",
        nodeId: node.id
      });
      continue;
    }

    if (criticalNodeTypes.has(node.nodeType) && node.sourceRefs.length === 0) {
      errors.push({
        code: "critical_fact_without_source",
        message: `关键事实节点「${node.label}」缺少来源引用。`,
        nodeId: node.id
      });
    }

    for (const sourceRef of node.sourceRefs) {
      if (!sourceRefs.has(sourceRef)) {
        errors.push({
          code: "source_ref_not_found",
          message: `节点「${node.label}」引用了不存在的来源：${sourceRef}。`,
          nodeId: node.id
        });
      }

      if (
        mainClaimNodeTypes.has(node.nodeType) &&
        externalAuthorityByRef.get(sourceRef) === "low"
      ) {
        errors.push({
          code: "external_low_authority_main_claim",
          message: `主张节点「${node.label}」使用了低权威外部来源：${sourceRef}。`,
          nodeId: node.id
        });
      }
    }
  }

  for (const paperId of options.selectedPaperIds) {
    const paperRefs = artifact.sources.selectedPapers
      .filter((source) => source.paperId === paperId)
      .map((source) => source.refId);
    const covered = nodes.some((node) =>
      node.sourceRefs.some((sourceRef) => paperRefs.includes(sourceRef))
    );

    if (!covered) {
      errors.push({
        code: "missing_selected_paper_coverage",
        message: `选中文献 ${paperId} 没有被思维导图节点覆盖。`
      });
    }
  }

  return {
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    errors,
    repairable: errors.length > 0,
    status: errors.length > 0 ? "fail" : "pass",
    warnings: []
  };
}

const criticalNodeTypes = new Set<MindmapNodeType>([
  "comparison",
  "concept",
  "conflict",
  "evidence",
  "method",
  "paper_claim"
]);

const mainClaimNodeTypes = new Set<MindmapNodeType>([
  "comparison",
  "conflict",
  "method",
  "paper_claim"
]);

function collectSourceRefs(catalog: MindmapSourceCatalog): Set<string> {
  return new Set([
    ...catalog.selectedPapers.map((source) => source.refId),
    ...catalog.externalReferences.map((source) => source.refId),
    ...catalog.inferences.map((source) => source.refId)
  ]);
}

function walkNodes(root: MindmapNode): MindmapNode[] {
  return [root, ...root.children.flatMap((child) => walkNodes(child))];
}

function isStructurallyValidNode(node: MindmapNode): boolean {
  return Boolean(
    node.id.trim() &&
      node.label.trim() &&
      Array.isArray(node.children) &&
      Array.isArray(node.sourceRefs)
  );
}
