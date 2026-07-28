import type {
  AdvanceThinReadingDocumentInput,
  CreateThinReadingDocumentInput,
  ThinReadingAnnotation,
  ThinReadingAnnotationTarget,
  ThinReadingDocument,
  ThinReadingBranchSource,
  ThinReadingIntuechoRecommendation,
  ThinReadingClaim,
  ThinReadingEvidenceSpan,
  ThinReadingNode,
  ThinReadingNodeEvidence,
  ThinReadingNodeSource,
  ThinReadingRecommendationScope
} from "./thinReading.types";
import {
  freezePaperIdentity,
  resolvePaperIdentityMap
} from "../paper-identity/paperIdentity";

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

export type CreateThinReadingAnnotationInput = {
  body: string;
  createdAt?: string;
  excerpt: string;
  nodeId: string;
  target?: ThinReadingAnnotationTarget;
  visibility?: ThinReadingAnnotation["visibility"];
};

type ThinReadingLocale = "en" | "zh";

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
  return Object.freeze({
    ...scope,
    paperIdentity: scope.paperIdentity ? freezePaperIdentity(scope.paperIdentity) : undefined
  });
}

function freezeRecommendation(
  recommendation: ThinReadingIntuechoRecommendation
): ThinReadingIntuechoRecommendation {
  return Object.freeze({ ...recommendation });
}

function freezeEvidenceSpan(span: ThinReadingEvidenceSpan): ThinReadingEvidenceSpan {
  return Object.freeze({ ...span });
}

function freezeClaim(claim: ThinReadingClaim): ThinReadingClaim {
  return Object.freeze({
    ...claim,
    evidenceIds: Object.freeze([...claim.evidenceIds])
  });
}

function freezeEvidence(evidence: ThinReadingNodeEvidence): ThinReadingNodeEvidence {
  return Object.freeze({
    claims: evidence.claims
      ? Object.freeze(evidence.claims.map(freezeClaim))
      : undefined,
    externalKnowledge: Object.freeze([...evidence.externalKnowledge]),
    paperEvidence: Object.freeze([...evidence.paperEvidence]),
    paperEvidenceSpans: evidence.paperEvidenceSpans
      ? Object.freeze(evidence.paperEvidenceSpans.map(freezeEvidenceSpan))
      : undefined
  });
}

function freezeNode(node: ThinReadingNode): ThinReadingNode {
  return Object.freeze({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    evidence: freezeEvidence(node.evidence),
    omittedSections: Object.freeze(node.omittedSections.map((token) => Object.freeze({ ...token }))),
    recommendationScope: freezeScope(node.recommendationScope),
    recommendations: Object.freeze(node.recommendations.map(freezeRecommendation)),
    source: freezeSource(node.source)
  });
}

function freezeAnnotation(annotation: ThinReadingAnnotation): ThinReadingAnnotation {
  return Object.freeze({
    ...annotation,
    target: Object.freeze({ ...annotation.target }) as ThinReadingAnnotationTarget
  });
}

function freezeDocument(document: ThinReadingDocument): ThinReadingDocument {
  return Object.freeze({
    ...document,
    annotationSettings: Object.freeze({ ...document.annotationSettings }),
    annotations: Object.freeze(document.annotations.map(freezeAnnotation)),
    paperIdentities: document.paperIdentities
      ? Object.freeze(
          Object.fromEntries(
            Object.entries(document.paperIdentities).map(([paperId, identity]) => [
              paperId,
              freezePaperIdentity(identity)
            ])
          )
        )
      : undefined,
    paperIds: Object.freeze([...document.paperIds]),
    nodes: Object.freeze(
      Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, freezeNode(node)]))
    ),
    pendingPublicAnnotationIds: Object.freeze([...document.pendingPublicAnnotationIds])
  });
}

function localeForTargetLanguage(targetLanguage: string): ThinReadingLocale {
  const normalized = targetLanguage.trim().toLowerCase();
  return normalized.startsWith("zh") || normalized === "system" ? "zh" : "en";
}

function createNodeCreatedAt(seed: string): string {
  const milliseconds = parseInt(stableHash(seed).slice(0, 8), 16) % 86_400_000;
  return new Date(milliseconds).toISOString();
}

function sourceLabel(source: ThinReadingBranchSource): "遗漏板块" | "正文选区" {
  return source.kind === "omitted_section" ? "遗漏板块" : "正文选区";
}

function createRootTitle(papers: string[], targetLanguage: string): string {
  if (papers.length > 0) {
    return papers[0];
  }
  return localeForTargetLanguage(targetLanguage) === "zh" ? "总述" : "Overview";
}

export function createThinReadingDocument(
  input: CreateThinReadingDocumentInput
): ThinReadingDocument {
  const papers = [...input.papers];
  const paperIds = papers.map((paper) => paper.id);
  const paperTitles = papers.map((paper) => paper.title);
  const paperIdentities = resolvePaperIdentityMap(papers);
  const primaryPaperId = paperIds[0];
  const rootNodeId = `thin-reading-root-${stableHash(
    [input.artifactId, input.targetLanguage, ...papers.flatMap((paper) => [paper.id, paper.title])].join("\u0000")
  )}`;
  const rootTitle = createRootTitle(paperTitles, input.targetLanguage);
  const rootNode: ThinReadingNode = {
    childIds: [],
    createdAt: createNodeCreatedAt(rootNodeId),
    depth: 0,
    id: rootNodeId,
    evidence: input.rootSeed.evidence,
    omittedSections: input.rootSeed.omittedSections,
    paperType: input.rootSeed.paperType,
    recommendationScope: {
      kind: "whole_paper",
      paperId: primaryPaperId,
      paperIdentity: primaryPaperId ? paperIdentities[primaryPaperId] : undefined
    },
    recommendations: input.rootSeed.recommendations,
    source: { kind: "root_overview" },
    summary: input.rootSeed.summary,
    title: rootTitle,
    withinPaperClosure: input.rootSeed.withinPaperClosure
  };

  return freezeDocument({
    annotationSettings: { autoPublic: false },
    annotations: [],
    artifactId: input.artifactId,
    paperIdentities,
    paperIds,
    title: rootNode.title,
    targetLanguage: input.targetLanguage,
    activeNodeId: rootNodeId,
    nodes: { [rootNodeId]: rootNode },
    pendingPublicAnnotationIds: [],
    rootNodeId,
    version: "liteasy.thin-reading/v1"
  });
}

function recommendationScopeForSource(
  document: ThinReadingDocument,
  source: ThinReadingBranchSource
): ThinReadingRecommendationScope {
  const paperId = document.paperIds[0];
  const paperIdentity = paperId ? document.paperIdentities?.[paperId] : undefined;
  if (source.kind === "omitted_section") {
    return { kind: "section", paperId, paperIdentity, sectionKey: source.sectionKey };
  }
  return { kind: "selected_passage", excerpt: source.excerpt, paperId, paperIdentity };
}

export function truncateThinReadingTitle(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
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
    evidence: input.seed.evidence,
    omittedSections: input.seed.omittedSections,
    paperType: input.seed.paperType,
    parentId: parent.id,
    recommendationScope: recommendationScopeForSource(document, source),
    recommendations: input.seed.recommendations,
    source,
    summary: input.seed.summary,
    title: input.title,
    withinPaperClosure: input.seed.withinPaperClosure
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

export function findThinReadingChildBySource(
  document: ThinReadingDocument,
  parentNodeId: string,
  source: ThinReadingBranchSource
) {
  const parent = document.nodes[parentNodeId];
  if (!parent) {
    return null;
  }
  const sourceKey = JSON.stringify(source);
  const childId = parent.childIds.find((candidateId) =>
    JSON.stringify(document.nodes[candidateId]?.source) === sourceKey
  );
  return childId ? document.nodes[childId] ?? null : null;
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

function pendingIdsFor(annotations: readonly ThinReadingAnnotation[]) {
  return annotations
    .filter((annotation) => annotation.visibility === "pending_public")
    .map((annotation) => annotation.id);
}

export function setThinReadingAutoPublic(
  document: ThinReadingDocument,
  autoPublic: boolean
): ThinReadingDocument {
  return freezeDocument({
    ...document,
    annotationSettings: {
      ...document.annotationSettings,
      autoPublic
    }
  });
}

export function addThinReadingAnnotation(
  document: ThinReadingDocument,
  input: CreateThinReadingAnnotationInput
): ThinReadingDocument {
  const node = document.nodes[input.nodeId];
  if (!node) {
    throw new Error(`Thin-reading node not found: ${input.nodeId}`);
  }
  const body = input.body.replace(/\s+/g, " ").trim();
  const excerpt = input.excerpt.replace(/\s+/g, " ").trim();
  if (!body) {
    return document;
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const visibility = input.visibility ??
    (document.annotationSettings.autoPublic ? "pending_public" : "private");
  const annotation: ThinReadingAnnotation = {
    artifactId: document.artifactId,
    body,
    createdAt,
    excerpt,
    id: `thin-reading-annotation-${stableHash(
      `${document.artifactId}\u0000${input.nodeId}\u0000${excerpt}\u0000${body}\u0000${createdAt}`
    )}`,
    nodeId: input.nodeId,
    target: input.target ?? { kind: "node_summary", nodeId: input.nodeId },
    updatedAt: createdAt,
    visibility
  };
  const annotations = [...document.annotations, annotation];
  return freezeDocument({
    ...document,
    annotations,
    pendingPublicAnnotationIds: pendingIdsFor(annotations)
  });
}

export function updateThinReadingAnnotation(
  document: ThinReadingDocument,
  annotationId: string,
  body: string
): ThinReadingDocument {
  const normalizedBody = body.replace(/\s+/g, " ").trim();
  if (!normalizedBody) {
    return document;
  }
  const annotations = document.annotations.map((annotation) =>
    annotation.id === annotationId
      ? {
          ...annotation,
          body: normalizedBody,
          updatedAt: new Date().toISOString()
        }
      : annotation
  );
  return freezeDocument({
    ...document,
    annotations,
    pendingPublicAnnotationIds: pendingIdsFor(annotations)
  });
}

export function setThinReadingAnnotationPublic(
  document: ThinReadingDocument,
  annotationId: string,
  publicRequested: boolean
): ThinReadingDocument {
  const annotations = document.annotations.map((annotation) =>
    annotation.id === annotationId
      ? {
          ...annotation,
          updatedAt: new Date().toISOString(),
          visibility: publicRequested ? "pending_public" as const : "private" as const
        }
      : annotation
  );
  return freezeDocument({
    ...document,
    annotations,
    pendingPublicAnnotationIds: pendingIdsFor(annotations)
  });
}

export function deleteThinReadingAnnotation(
  document: ThinReadingDocument,
  annotationId: string
): ThinReadingDocument {
  const annotations = document.annotations.filter((annotation) => annotation.id !== annotationId);
  return freezeDocument({
    ...document,
    annotations,
    pendingPublicAnnotationIds: pendingIdsFor(annotations)
  });
}
