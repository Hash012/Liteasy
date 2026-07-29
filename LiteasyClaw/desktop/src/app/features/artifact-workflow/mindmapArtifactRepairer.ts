import type {
  MindmapArtifact,
  MindmapNode,
  MindmapVerificationReport
} from "./mindmapArtifact.types";

export type MindmapAppliedRepair = {
  code: "inherited_parent_source_refs";
  nodeId: string;
  sourceRefs: string[];
};

export type MindmapRepairResult = {
  appliedRepairs: MindmapAppliedRepair[];
  artifact: MindmapArtifact;
  unresolvedIssueCodes: string[];
};

const repairableIssueCodes = new Set(["critical_fact_without_source"]);

export function repairMindmapArtifact(
  artifact: MindmapArtifact,
  verification: MindmapVerificationReport
): MindmapRepairResult {
  const appliedRepairs: MindmapAppliedRepair[] = [];
  const repairableNodeIds = new Set(
    verification.errors
      .filter((issue) => issue.code === "critical_fact_without_source" && issue.nodeId)
      .map((issue) => issue.nodeId!)
  );
  const repairedRoot = repairNode(artifact.root, undefined, repairableNodeIds, appliedRepairs);

  return {
    appliedRepairs,
    artifact: {
      ...artifact,
      root: repairedRoot
    },
    unresolvedIssueCodes: verification.errors
      .map((issue) => issue.code)
      .filter((code) => !repairableIssueCodes.has(code))
  };
}

function repairNode(
  node: MindmapNode,
  parent: MindmapNode | undefined,
  repairableNodeIds: Set<string>,
  appliedRepairs: MindmapAppliedRepair[]
): MindmapNode {
  const inheritedSourceRefs = repairableNodeIds.has(node.id) &&
    node.sourceRefs.length === 0 &&
    parent &&
    parent.sourceRefs.length > 0
    ? parent.sourceRefs
    : undefined;
  const repairedNode = {
    ...node,
    sourceRefs: inheritedSourceRefs ?? node.sourceRefs
  };

  if (inheritedSourceRefs) {
    appliedRepairs.push({
      code: "inherited_parent_source_refs",
      nodeId: node.id,
      sourceRefs: inheritedSourceRefs
    });
  }

  return {
    ...repairedNode,
    children: node.children.map((child) =>
      repairNode(child, repairedNode, repairableNodeIds, appliedRepairs)
    )
  };
}
