import type {
  AdvanceThinReadingDocumentInput,
  CreateThinReadingDocumentInput,
  ThinReadingAnnotation,
  ThinReadingAnnotationSyncState,
  ThinReadingAnnotationTarget,
  ThinReadingAnchor,
  ThinReadingDocument,
  ThinReadingDocumentV2,
  ThinReadingBranchSource,
  ThinReadingIntuechoRecommendation,
  ThinReadingClaim,
  ThinReadingClosureState,
  ThinReadingEvidenceSpan,
  ThinReadingExternalSource,
  ThinReadingGenerationAudit,
  ThinReadingNode,
  ThinReadingNodeV2,
  ThinReadingNodeEvidence,
  ThinReadingNodeEvidenceV1,
  ThinReadingNodeSource,
  ThinReadingRecommendationPaperEdge,
  ThinReadingRecommendationScope,
  ThinReadingSummarySentence
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

export function resolveThinReadingClosureState(input: {
  closureState?: ThinReadingClosureState;
  depth: number;
  withinPaperClosure: boolean;
}): ThinReadingClosureState {
  if (!input.withinPaperClosure) {
    return "outside_paper";
  }
  if (input.closureState === "near_boundary") {
    return "near_boundary";
  }
  // The next interaction at depth three retrieves external sources. Flag the
  // preceding internal level so readers understand the transition before it occurs.
  return input.depth >= 2 ? "near_boundary" : "inside_paper";
}

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
  return Object.freeze({
    ...source,
    evidenceIds: source.kind === "selected_text" && source.evidenceIds
      ? Object.freeze([...source.evidenceIds])
      : undefined,
    externalSourceIds: source.kind === "selected_text" && source.externalSourceIds
      ? Object.freeze([...source.externalSourceIds])
      : undefined
  });
}

function freezeScope(scope: ThinReadingRecommendationScope): ThinReadingRecommendationScope {
  return Object.freeze({
    ...scope,
    evidenceIds: scope.kind === "selected_passage" && scope.evidenceIds
      ? Object.freeze([...scope.evidenceIds])
      : undefined,
    externalSourceIds: scope.kind === "selected_passage" && scope.externalSourceIds
      ? Object.freeze([...scope.externalSourceIds])
      : undefined,
    paperIdentity: scope.paperIdentity ? freezePaperIdentity(scope.paperIdentity) : undefined
  });
}

function freezeRecommendation(
  recommendation: ThinReadingIntuechoRecommendation
): ThinReadingIntuechoRecommendation {
  return Object.freeze({ ...recommendation });
}

function retainCommunityRecommendations(
  recommendations: readonly ThinReadingIntuechoRecommendation[]
) {
  return recommendations.filter((recommendation) => recommendation.source === "intuecho_community");
}

function freezeEvidenceSpan(span: ThinReadingEvidenceSpan): ThinReadingEvidenceSpan {
  return Object.freeze({ ...span });
}

function freezeExternalSource(source: ThinReadingExternalSource): ThinReadingExternalSource {
  return Object.freeze({
    ...source,
    authors: Object.freeze([...source.authors])
  });
}

function freezeClaim(claim: ThinReadingClaim): ThinReadingClaim {
  return Object.freeze({
    ...claim,
    evidenceIds: Object.freeze([...claim.evidenceIds])
  });
}

function freezeSummarySentence(sentence: ThinReadingSummarySentence): ThinReadingSummarySentence {
  return Object.freeze({
    ...sentence,
    evidenceIds: Object.freeze([...sentence.evidenceIds]),
    externalKnowledge: Object.freeze([...sentence.externalKnowledge])
  });
}

function freezeAnchor(anchor: ThinReadingAnchor): ThinReadingAnchor {
  return Object.freeze({
    ...anchor,
    evidenceIds: Object.freeze([...anchor.evidenceIds]),
    externalSourceIds: Object.freeze([...anchor.externalSourceIds]),
    quality: anchor.quality ? Object.freeze({ ...anchor.quality }) : undefined
  });
}

function freezeRecommendationPaperEdge(
  edge: ThinReadingRecommendationPaperEdge
): ThinReadingRecommendationPaperEdge {
  return Object.freeze({
    ...edge,
    evidenceRecordUrls: Object.freeze([...edge.evidenceRecordUrls])
  });
}

function freezeGenerationAudit(audit: ThinReadingGenerationAudit): ThinReadingGenerationAudit {
  return Object.freeze({
    contextManagement: audit.contextManagement
      ? Object.freeze({ ...audit.contextManagement })
      : undefined,
    interpretationPlan: audit.interpretationPlan
      ? Object.freeze({
          ...audit.interpretationPlan,
          discourseMoves: Object.freeze([...audit.interpretationPlan.discourseMoves]),
          ...(audit.interpretationPlan.learningGoals ? {
            learningGoals: Object.freeze([...audit.interpretationPlan.learningGoals])
          } : {})
        })
      : undefined,
    evidenceLoop: audit.evidenceLoop
      ? Object.freeze({
          rounds: Object.freeze(audit.evidenceLoop.rounds.map((round) => Object.freeze({
            ...round,
            focus: Object.freeze([...round.focus]),
            observedEvidenceIds: Object.freeze([...round.observedEvidenceIds]),
            pageRequests: Object.freeze([...round.pageRequests]),
            searchQueries: Object.freeze([...round.searchQueries]),
            selectedEvidenceIds: Object.freeze([...round.selectedEvidenceIds]),
            toolCalls: Object.freeze(round.toolCalls.map((call) => Object.freeze({
              ...call,
              evidenceIds: Object.freeze([...call.evidenceIds]),
              pages: call.pages ? Object.freeze([...call.pages]) : undefined
            })))
          }))),
          stopReason: audit.evidenceLoop.stopReason,
          stopReasonDetail: audit.evidenceLoop.stopReasonDetail
        })
      : undefined,
    evidencePlan: audit.evidencePlan
      ? Object.freeze({
          focus: Object.freeze([...audit.evidencePlan.focus]),
          selectedEvidenceIds: Object.freeze([...audit.evidencePlan.selectedEvidenceIds])
        })
      : undefined,
    evidenceReview: audit.evidenceReview
      ? Object.freeze({
          ...audit.evidenceReview,
          unsupportedSentenceIds: Object.freeze([...audit.evidenceReview.unsupportedSentenceIds])
        })
      : undefined,
    evidenceToolCalls: audit.evidenceToolCalls
      ? Object.freeze(audit.evidenceToolCalls.map((call) => Object.freeze({
          ...call,
          evidenceIds: Object.freeze([...call.evidenceIds]),
          pages: call.pages ? Object.freeze([...call.pages]) : undefined
        })))
      : undefined,
    model: Object.freeze({ ...audit.model }),
    qualityGate: Object.freeze({
      ...audit.qualityGate,
      repairReasons: Object.freeze([...audit.qualityGate.repairReasons])
    }),
    workload: audit.workload
      ? Object.freeze({
          ...audit.workload,
          plannedSubagents: Object.freeze([...audit.workload.plannedSubagents])
        })
      : undefined,
    version: audit.version
  });
}

function freezeEvidence(evidence: ThinReadingNodeEvidence): ThinReadingNodeEvidence {
  const frozen = {
    anchors: evidence.anchors
      ? Object.freeze(evidence.anchors.map(freezeAnchor))
      : undefined,
    claims: evidence.claims
      ? Object.freeze(evidence.claims.map(freezeClaim))
      : undefined,
    externalKnowledge: Object.freeze([...evidence.externalKnowledge]),
    externalSources: evidence.externalSources
      ? Object.freeze(evidence.externalSources.map(freezeExternalSource))
      : undefined,
    generationAudit: evidence.generationAudit
      ? freezeGenerationAudit(evidence.generationAudit)
      : undefined,
    paperEvidence: Object.freeze([...evidence.paperEvidence]),
    paperEvidenceSpans: evidence.paperEvidenceSpans
      ? Object.freeze(evidence.paperEvidenceSpans.map(freezeEvidenceSpan))
      : undefined,
    recommendedFigures: evidence.recommendedFigures
      ? Object.freeze(evidence.recommendedFigures.map((figure) => Object.freeze({
          ...figure,
          evidenceIds: Object.freeze([...figure.evidenceIds])
        })))
      : undefined,
    recommendationPaperEdges: evidence.recommendationPaperEdges
      ? Object.freeze(evidence.recommendationPaperEdges.map(freezeRecommendationPaperEdge))
      : undefined,
    summarySentences: evidence.summarySentences
      ? Object.freeze(evidence.summarySentences.map(freezeSummarySentence))
      : undefined
  } as ThinReadingNodeEvidence;
  if (evidence.interactiveDemo !== undefined) {
    (frozen as ThinReadingNodeEvidenceV1).interactiveDemo = Object.freeze({ ...evidence.interactiveDemo });
  }
  if (evidence.mermaid !== undefined) {
    (frozen as ThinReadingNodeEvidenceV1).mermaid = evidence.mermaid;
  }
  return Object.freeze(frozen);
}

function freezeNode(node: ThinReadingNode): ThinReadingNode {
  return Object.freeze({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    evidence: freezeEvidence(node.evidence),
    omittedSections: Object.freeze(node.omittedSections.map((token) => Object.freeze({ ...token }))),
    recommendationScope: freezeScope(node.recommendationScope),
    recommendations: Object.freeze(node.recommendations.map(freezeRecommendation)),
    source: freezeSource(node.source),
    ...("visualizations" in node ? {
      visualizations: Object.freeze([...node.visualizations]),
      visualizationDecision: node.visualizationDecision
        ? Object.freeze({ ...node.visualizationDecision, intent: Object.freeze({
            ...node.visualizationDecision.intent,
            candidateModalities: Object.freeze([...node.visualizationDecision.intent.candidateModalities]),
            evidenceIds: Object.freeze([...node.visualizationDecision.intent.evidenceIds])
          }) })
        : undefined
    } : {})
  });
}

function freezeAnnotation(annotation: ThinReadingAnnotation): ThinReadingAnnotation {
  return Object.freeze({
    ...annotation,
    syncState: annotation.syncState ? Object.freeze({ ...annotation.syncState }) as ThinReadingAnnotationSyncState : undefined,
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
  }) as ThinReadingDocument;
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

function toV2Evidence(evidence: ThinReadingNodeEvidence): ThinReadingNodeV2["evidence"] {
  const { interactiveDemo: _interactiveDemo, mermaid: _mermaid, ...safeEvidence } = evidence;
  return safeEvidence;
}

export function createThinReadingDocument(
  input: CreateThinReadingDocumentInput
): ThinReadingDocumentV2 {
  const papers = [...input.papers];
  const paperIds = papers.map((paper) => paper.id);
  const paperTitles = papers.map((paper) => paper.title);
  const paperIdentities = resolvePaperIdentityMap(papers);
  const primaryPaperId = paperIds[0];
  const rootNodeId = `thin-reading-root-${stableHash(
    [input.artifactId, input.targetLanguage, ...papers.flatMap((paper) => [paper.id, paper.title])].join("\u0000")
  )}`;
  const rootTitle = createRootTitle(paperTitles, input.targetLanguage);
  const rootNode: ThinReadingNodeV2 = {
    childIds: [],
    closureState: resolveThinReadingClosureState({
      closureState: input.rootSeed.closureState,
      depth: 0,
      withinPaperClosure: input.rootSeed.withinPaperClosure
    }),
    createdAt: createNodeCreatedAt(rootNodeId),
    depth: 0,
    id: rootNodeId,
    evidence: toV2Evidence(input.rootSeed.evidence),
    omittedSections: input.rootSeed.omittedSections,
    paperType: input.rootSeed.paperType,
    recommendationScope: {
      kind: "whole_paper",
      paperId: primaryPaperId,
      paperIdentity: primaryPaperId ? paperIdentities[primaryPaperId] : undefined
    },
    recommendations: retainCommunityRecommendations(input.rootSeed.recommendations),
    source: { kind: "root_overview" },
    summary: input.rootSeed.summary,
    title: rootTitle,
    withinPaperClosure: input.rootSeed.withinPaperClosure,
    visualizations: []
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
    version: "liteasy.thin-reading/v2"
  }) as ThinReadingDocumentV2;
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
  return {
    kind: "selected_passage",
    ...(source.evidenceIds ? { evidenceIds: [...source.evidenceIds] } : {}),
    ...(source.externalSourceIds ? { externalSourceIds: [...source.externalSourceIds] } : {}),
    excerpt: source.excerpt,
    paperId,
    paperIdentity
  };
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
  if (document.version === "liteasy.thin-reading/v1") {
    throw new Error("thin_reading_v1_read_only");
  }
  const v2Document = document as ThinReadingDocumentV2;
  const parent = v2Document.nodes[input.parentNodeId];
  if (!parent) {
    throw new Error(`Thin-reading node not found: ${input.parentNodeId}`);
  }
  const childId = `thin-reading-node-${stableHash(
    `${v2Document.artifactId}\u0000${parent.id}\u0000${JSON.stringify(input.source)}`
  )}`;
  const existingChild = document.nodes[childId];
  if (existingChild) {
    return freezeDocument({ ...v2Document, activeNodeId: childId });
  }
  const source = input.source;

  const child: ThinReadingNodeV2 = {
    childIds: [],
    closureState: resolveThinReadingClosureState({
      closureState: input.seed.closureState,
      depth: parent.depth + 1,
      withinPaperClosure: input.seed.withinPaperClosure
    }),
    createdAt: input.createdAt ?? createNodeCreatedAt(childId),
    depth: parent.depth + 1,
    id: childId,
    evidence: toV2Evidence(input.seed.evidence),
    omittedSections: input.seed.omittedSections,
    paperType: input.seed.paperType,
    parentId: parent.id,
    recommendationScope: recommendationScopeForSource(v2Document, source),
    recommendations: retainCommunityRecommendations(input.seed.recommendations),
    source,
    summary: input.seed.summary,
    title: input.title,
    withinPaperClosure: input.seed.withinPaperClosure,
    visualizations: []
  };
  const updatedParent: ThinReadingNodeV2 = {
    ...parent,
    childIds: [...parent.childIds, childId]
  };

  return freezeDocument({
    ...v2Document,
    activeNodeId: childId,
    nodes: {
      ...v2Document.nodes,
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
    .filter((annotation) => annotation.visibility === "pending_public" && annotation.syncState?.status !== "synced")
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
          syncState: annotation.visibility === "pending_public" ? undefined : annotation.syncState,
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
          syncState: publicRequested ? undefined : undefined,
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

export function applyThinReadingAnnotationSyncResults(
  document: ThinReadingDocument,
  results: readonly (
    | { annotationId: string; error: string; status: "failed" }
    | { annotationId: string; intuechoAnnotationId: string; status: "synced"; syncedAt: string }
    | { annotationId: string; status: "pending_public" }
  )[],
  attemptedAt = new Date().toISOString(),
  expectedUpdatedAtByAnnotationId?: ReadonlyMap<string, string>
): ThinReadingDocument {
  const resultsByAnnotationId = new Map(results.map((result) => [result.annotationId, result]));
  const annotations = document.annotations.map((annotation) => {
    if (annotation.visibility !== "pending_public") {
      return annotation;
    }
    if (annotation.syncState?.status === "synced" ||
      (expectedUpdatedAtByAnnotationId && expectedUpdatedAtByAnnotationId.get(annotation.id) !== annotation.updatedAt)) {
      return annotation;
    }
    const result = resultsByAnnotationId.get(annotation.id);
    if (!result || result.status === "pending_public") {
      return annotation;
    }
    return result.status === "synced"
      ? { ...annotation, syncState: { intuechoAnnotationId: result.intuechoAnnotationId, status: "synced" as const, syncedAt: result.syncedAt } }
      : { ...annotation, syncState: { error: result.error, lastAttemptAt: attemptedAt, status: "failed" as const } };
  });
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
