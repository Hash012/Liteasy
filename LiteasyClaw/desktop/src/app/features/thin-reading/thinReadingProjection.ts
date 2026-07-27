import type {
  AdvanceThinReadingDocumentInput,
  CreateThinReadingDocumentInput,
  ThinReadingDocument,
  ThinReadingBranchSource,
  ThinReadingIntuechoRecommendation,
  ThinReadingNode,
  ThinReadingNodeSource,
  ThinReadingRecommendationScope,
  ThinReadingSectionToken
} from "./thinReading.types";

const OMITTED_SECTION_DEFINITIONS = [
  ["实验", "experiment"],
  ["消融", "ablation"],
  ["数据集", "dataset"],
  ["局限", "limitations"],
  ["索引代价", "index_cost"]
] as const;

export type ThinReadingBranchOption = {
  child: ThinReadingNode;
  createdAt: string;
  depth: number;
  nodeId: string;
  recommendationCount: number;
  sourceLabel: "遗漏板块" | "正文选区";
  title: string;
  withinPaperClosure: boolean;
};

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function freezeSource(source: ThinReadingNodeSource): ThinReadingNodeSource {
  return Object.freeze({ ...source });
}

function freezeScope(scope: ThinReadingRecommendationScope): ThinReadingRecommendationScope {
  return Object.freeze({ ...scope });
}

function freezeRecommendation(
  recommendation: ThinReadingIntuechoRecommendation
): ThinReadingIntuechoRecommendation {
  return Object.freeze({ ...recommendation });
}

function freezeNode(node: ThinReadingNode): ThinReadingNode {
  return Object.freeze({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    omittedSections: Object.freeze(node.omittedSections.map((token) => Object.freeze({ ...token }))),
    recommendationScope: freezeScope(node.recommendationScope),
    recommendations: Object.freeze(node.recommendations.map(freezeRecommendation)),
    source: freezeSource(node.source)
  });
}

function freezeDocument(document: ThinReadingDocument): ThinReadingDocument {
  return Object.freeze({
    ...document,
    paperIds: Object.freeze([...document.paperIds]),
    nodes: Object.freeze(
      Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, freezeNode(node)]))
    )
  });
}

function createOmittedSections(): readonly ThinReadingSectionToken[] {
  return Object.freeze(
    OMITTED_SECTION_DEFINITIONS.map(([label, sectionKey]) =>
      Object.freeze({
        id: `section-${stableHash(sectionKey)}`,
        label,
        sectionKey
      })
    )
  );
}

function createRecommendations(seed: string): readonly ThinReadingIntuechoRecommendation[] {
  return Object.freeze([
    Object.freeze({
      id: `intuecho-${stableHash(seed)}`,
      compatibility: 0.84,
      note: "与当前薄读范围相关的本地直觉提示。",
      relationship: "方法与问题定义"
    })
  ]);
}

function createNodeCreatedAt(seed: string): string {
  const milliseconds = parseInt(stableHash(seed).slice(0, 8), 16) % 86_400_000;
  return new Date(milliseconds).toISOString();
}

function sourceLabel(source: ThinReadingBranchSource): "遗漏板块" | "正文选区" {
  return source.kind === "omitted_section" ? "遗漏板块" : "正文选区";
}

function createRootSummary(input: CreateThinReadingDocumentInput, papers: string[]): string {
  const chunks = Object.values(input.importedChunksByPaperId ?? {})
    .flat()
    .filter(Boolean)
    .sort();
  const context = chunks.length > 0 ? ` 可用上下文：${chunks.join(" ")}` : "";
  return `围绕 ${papers.join("、")} 的薄读总述。${context}`;
}

export function createThinReadingDocument(
  input: CreateThinReadingDocumentInput
): ThinReadingDocument {
  const papers = [...input.papers].sort((left, right) =>
    `${left.id}\u0000${left.title}`.localeCompare(`${right.id}\u0000${right.title}`)
  );
  const paperIds = papers.map((paper) => paper.id);
  const paperTitles = papers.map((paper) => paper.title);
  const rootNodeId = `thin-reading-root-${stableHash(
    [input.artifactId, input.targetLanguage, ...papers.flatMap((paper) => [paper.id, paper.title])].join("\u0000")
  )}`;
  const rootNode: ThinReadingNode = {
    childIds: [],
    createdAt: createNodeCreatedAt(rootNodeId),
    depth: 0,
    id: rootNodeId,
    omittedSections: createOmittedSections(),
    recommendationScope: { kind: "whole_paper", paperId: paperIds[0] },
    recommendations: createRecommendations(rootNodeId),
    source: { kind: "root_overview" },
    summary: createRootSummary(input, paperTitles),
    title: paperTitles.length > 0 ? `薄读：${paperTitles[0]}` : "薄读",
    withinPaperClosure: false
  };

  return freezeDocument({
    artifactId: input.artifactId,
    paperIds,
    title: rootNode.title,
    targetLanguage: input.targetLanguage,
    activeNodeId: rootNodeId,
    nodes: { [rootNodeId]: rootNode },
    rootNodeId,
    version: "liteasy.thin-reading/v1"
  });
}

function recommendationScopeForSource(source: ThinReadingBranchSource): ThinReadingRecommendationScope {
  if (source.kind === "omitted_section") {
    return { kind: "section", sectionKey: source.sectionKey };
  }
  return { kind: "selected_passage", excerpt: source.excerpt };
}

export function advanceThinReadingDocument(
  document: ThinReadingDocument,
  input: AdvanceThinReadingDocumentInput
): ThinReadingDocument {
  const parent = document.nodes[input.parentNodeId];
  if (!parent) {
    throw new Error(`Thin-reading node not found: ${input.parentNodeId}`);
  }
  const childId = `thin-reading-node-${stableHash(
    `${document.artifactId}\u0000${parent.id}\u0000${JSON.stringify(input.source)}`
  )}`;
  const existingChild = document.nodes[childId];
  if (existingChild) {
    return freezeDocument({ ...document, activeNodeId: childId });
  }
  const source = input.source;

  const child: ThinReadingNode = {
    childIds: [],
    createdAt: input.createdAt ?? createNodeCreatedAt(childId),
    depth: parent.depth + 1,
    id: childId,
    omittedSections: source.kind === "omitted_section"
      ? parent.omittedSections.filter((token) => token.sectionKey !== source.sectionKey)
      : parent.omittedSections,
    parentId: parent.id,
    recommendationScope: recommendationScopeForSource(source),
    recommendations: createRecommendations(childId),
    source,
    summary: input.summary,
    title: input.title,
    withinPaperClosure: input.withinPaperClosure ?? true
  };
  const updatedParent: ThinReadingNode = {
    ...parent,
    childIds: [...parent.childIds, childId]
  };

  return freezeDocument({
    ...document,
    activeNodeId: childId,
    nodes: {
      ...document.nodes,
      [parent.id]: updatedParent,
      [childId]: child
    }
  });
}

export function listThinReadingBranchOptions(
  document: ThinReadingDocument,
  nodeId: string
): readonly ThinReadingBranchOption[] {
  const node = document.nodes[nodeId];
  if (!node) {
    return [];
  }
  return Object.freeze(
    node.childIds.flatMap((childId) => {
      const child = document.nodes[childId];
      if (!child) {
        return [];
      }
      return [{
        child,
        createdAt: child.createdAt,
        depth: child.depth,
        nodeId: child.id,
        recommendationCount: child.recommendations.length,
        sourceLabel: child.source.kind === "root_overview" ? "正文选区" : sourceLabel(child.source),
        title: child.title,
        withinPaperClosure: child.withinPaperClosure
      }];
    })
  );
}
