import type {
  AdvanceThinReadingDocumentInput,
  CreateThinReadingDocumentInput,
  ThinReadingAnnotation,
  ThinReadingAnnotationSyncState,
  ThinReadingAnnotationTarget,
  ThinReadingAnchor,
  ThinReadingDocument,
  ThinReadingBranchSource,
  ThinReadingIntuechoRecommendation,
  ThinReadingClaim,
  ThinReadingClosureState,
  ThinReadingEvidenceSpan,
  ThinReadingExternalSource,
  ThinReadingGenerationAudit,
  ThinReadingNode,
  ThinReadingNodeEvidence,
  ThinReadingNodeSeed,
  ThinReadingNodeSource,
  ThinReadingRecommendationPaperEdge,
  ThinReadingRecommendationScope,
  ThinReadingSummarySentence,
  ThinReadingSupportMode
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

export function resolveThinReadingSentenceSupportMode(
  sentence: Pick<ThinReadingSummarySentence, "evidenceIds" | "externalKnowledge" | "supportMode">
): ThinReadingSupportMode {
  if (sentence.evidenceIds.length > 0 && sentence.externalKnowledge.length > 0) {
    return "paper_and_external";
  }
  if (sentence.evidenceIds.length > 0) return "paper";
  if (sentence.externalKnowledge.length > 0) return "external_only";
  return sentence.supportMode === "ai_interpretation" ? "ai_interpretation" : "paper";
}

const thinReadingExternalFallbackRoutes = new Set(["challenge", "context", "support"]);
const thinReadingExternalFallbackReasons = new Set([
  "all_routes_failed",
  "no_trusted_sources",
  "verification_exhausted"
]);

function isValidFallbackRoute(value: unknown) {
  return typeof value === "string" && thinReadingExternalFallbackRoutes.has(value);
}

function assertValidAiInterpretationFallbackAudit(audit: ThinReadingGenerationAudit["externalFallback"]) {
  if (!audit) {
    throw new Error("AI 理解节点缺少外部检索兜底审计。");
  }
  if (
    !Array.isArray(audit.attemptedRoutes) ||
    !audit.attemptedRoutes.every(isValidFallbackRoute) ||
    !Array.isArray(audit.completedRoutes) ||
    !audit.completedRoutes.every(isValidFallbackRoute) ||
    !thinReadingExternalFallbackReasons.has(audit.reason) ||
    !Number.isInteger(audit.carriedSourceCount) ||
    audit.carriedSourceCount < 0 ||
    audit.trustedSourceCount !== 0
  ) {
    throw new Error("AI 理解节点外部检索兜底审计无效。");
  }
}

function assertAiInterpretationEvidenceIsolated(evidence: ThinReadingNodeEvidence) {
  if (
    (evidence.externalSources?.length ?? 0) > 0 ||
    (evidence.paperEvidenceSpans?.length ?? 0) > 0 ||
    (evidence.anchors?.length ?? 0) > 0 ||
    (evidence.recommendedFigures?.length ?? 0) > 0 ||
    (evidence.recommendationPaperEdges?.length ?? 0) > 0 ||
    Boolean(evidence.mermaid?.trim()) ||
    Boolean(evidence.interactiveDemo)
  ) {
    throw new Error("AI 理解节点不得携带论文或外部来源证据。");
  }
  if (evidence.claims?.some((claim) => claim.evidenceIds.length > 0)) {
    throw new Error("AI 理解节点 claims 不得携带证据 ID。");
  }
  const summarySentences = evidence.summarySentences ?? [];
  if (
    summarySentences.length === 0 ||
    summarySentences.some((sentence) => (
      sentence.evidenceIds.length > 0 ||
      sentence.externalKnowledge.length > 0 ||
      sentence.status !== "unsupported" ||
      sentence.supportMode !== "ai_interpretation"
    ))
  ) {
    throw new Error("AI 理解节点句级来源状态必须全部为 unsupported/ai_interpretation。");
  }
}

export function resolveThinReadingSupportMode(input: {
  evidence: Pick<ThinReadingNodeEvidence,
    "externalKnowledge" | "generationAudit" | "paperEvidence" | "summarySentences">;
  supportMode?: ThinReadingSupportMode;
}): ThinReadingSupportMode {
  const hasPaper = input.evidence.paperEvidence.length > 0 ||
    Boolean(input.evidence.summarySentences?.some((sentence) => sentence.evidenceIds.length > 0));
  const hasExternal = input.evidence.externalKnowledge.length > 0 ||
    Boolean(input.evidence.summarySentences?.some((sentence) => sentence.externalKnowledge.length > 0));
  const inferred = hasPaper && hasExternal
    ? "paper_and_external"
    : hasExternal
      ? "external_only"
      : "paper";
  if (input.supportMode === "ai_interpretation") {
    if (hasPaper || hasExternal) {
      throw new Error("薄读支持模式与正文来源不一致：AI 理解不能携带论文或外部引用。");
    }
    if (!input.evidence.generationAudit?.externalFallback) {
      throw new Error("AI 理解节点缺少外部检索兜底审计。");
    }
    assertValidAiInterpretationFallbackAudit(input.evidence.generationAudit.externalFallback);
    if (input.evidence.generationAudit.aiInterpretationReview?.verdict !== "pass") {
      throw new Error("AI 理解节点缺少通过的 AI 独立理解审阅。");
    }
    assertAiInterpretationEvidenceIsolated(input.evidence as ThinReadingNodeEvidence);
    return "ai_interpretation";
  }
  if (input.supportMode && input.supportMode !== inferred) {
    throw new Error("薄读支持模式与正文来源不一致。");
  }
  return input.supportMode ?? inferred;
}

function assertAiInterpretationSeedBoundary(seed: ThinReadingNodeSeed) {
  if (seed.supportMode === "ai_interpretation" && seed.withinPaperClosure !== false) {
    throw new Error("AI 理解节点必须越出论文闭包。");
  }
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
    end: anchor.end,
    evidenceIds: Object.freeze([...anchor.evidenceIds]),
    externalSourceIds: Object.freeze([...anchor.externalSourceIds]),
    id: anchor.id,
    importance: anchor.importance,
    kind: anchor.kind,
    quality: anchor.quality ? Object.freeze({ ...anchor.quality }) : undefined,
    searchQuery: anchor.searchQuery,
    start: anchor.start,
    summarySentenceId: anchor.summarySentenceId,
    text: anchor.text
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

function freezeAiInterpretationReview(
  review: NonNullable<ThinReadingGenerationAudit["aiInterpretationReview"]>
) {
  return Object.freeze({
    reason: review.reason,
    unsafeSentenceIds: Object.freeze([...review.unsafeSentenceIds]),
    verdict: review.verdict
  });
}

function freezeExternalFallbackAudit(
  audit: NonNullable<ThinReadingGenerationAudit["externalFallback"]>
) {
  return Object.freeze({
    attemptedRoutes: Object.freeze([...audit.attemptedRoutes]),
    carriedSourceCount: audit.carriedSourceCount,
    completedRoutes: Object.freeze([...audit.completedRoutes]),
    reason: audit.reason,
    trustedSourceCount: audit.trustedSourceCount
  });
}

function freezeGenerationAudit(audit: ThinReadingGenerationAudit): ThinReadingGenerationAudit {
  return Object.freeze({
    aiInterpretationReview: audit.aiInterpretationReview
      ? freezeAiInterpretationReview(audit.aiInterpretationReview)
      : undefined,
    contextManagement: audit.contextManagement
      ? Object.freeze({ ...audit.contextManagement })
      : undefined,
    externalFallback: audit.externalFallback
      ? freezeExternalFallbackAudit(audit.externalFallback)
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
          rootOrientation: audit.evidenceReview.rootOrientation
            ? Object.freeze({ ...audit.evidenceReview.rootOrientation })
            : audit.evidenceReview.rootOrientation,
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
  return Object.freeze({
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
    interactiveDemo: evidence.interactiveDemo
      ? Object.freeze({
          ...evidence.interactiveDemo
        })
      : undefined,
    mermaid: evidence.mermaid,
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
    syncState: annotation.syncState ? Object.freeze({ ...annotation.syncState }) as ThinReadingAnnotationSyncState : undefined,
    target: Object.freeze({ ...annotation.target }) as ThinReadingAnnotationTarget
  });
}

function freezeDocument(document: ThinReadingDocument): ThinReadingDocument {
  return Object.freeze({
    ...document,
    annotationSettings: Object.freeze({ ...document.annotationSettings }),
    annotations: Object.freeze(document.annotations.map(freezeAnnotation)),
    literatureRecords: document.literatureRecords
      ? Object.freeze(Object.fromEntries(Object.entries(document.literatureRecords).map(([paperId, literature]) => [
          paperId,
          Object.freeze({
            ...literature,
            authors: Object.freeze([...literature.authors]),
            identifiers: Object.freeze(literature.identifiers.map((identifier) => Object.freeze({ ...identifier }))),
            provenance: Object.freeze({ ...literature.provenance })
          })
        ]))) as ThinReadingDocument["literatureRecords"]
      : undefined,
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
  assertAiInterpretationSeedBoundary(input.rootSeed);
  const papers = [...input.papers];
  const paperIds = papers.map((paper) => paper.id);
  const paperTitles = papers.map((paper) => paper.title);
  const paperIdentities = resolvePaperIdentityMap(papers);
  const literatureRecords = Object.fromEntries(
    papers.flatMap((paper) => paper.literature?.status === "confirmed"
      ? [[paper.id, paper.literature] as const]
      : [])
  );
  const primaryPaperId = paperIds[0];
  const rootNodeId = `thin-reading-root-${stableHash(
    [input.artifactId, input.targetLanguage, ...papers.flatMap((paper) => [paper.id, paper.title])].join("\u0000")
  )}`;
  const rootTitle = createRootTitle(paperTitles, input.targetLanguage);
  const rootNode: ThinReadingNode = {
    childIds: [],
    closureState: resolveThinReadingClosureState({
      closureState: input.rootSeed.closureState,
      depth: 0,
      withinPaperClosure: input.rootSeed.withinPaperClosure
    }),
    createdAt: createNodeCreatedAt(rootNodeId),
    depth: 0,
    id: rootNodeId,
    evidence: input.rootSeed.evidence,
    omittedSections: input.rootSeed.omittedSections,
    paperType: input.rootSeed.paperType,
    recommendationScope: {
      kind: "whole_paper",
      literatureId: primaryPaperId ? literatureRecords[primaryPaperId]?.literatureId : undefined,
      paperId: primaryPaperId,
      paperIdentity: primaryPaperId ? paperIdentities[primaryPaperId] : undefined
    },
    recommendations: retainCommunityRecommendations(input.rootSeed.recommendations),
    source: { kind: "root_overview" },
    summary: input.rootSeed.summary,
    supportMode: resolveThinReadingSupportMode({
      evidence: input.rootSeed.evidence,
      supportMode: input.rootSeed.supportMode
    }),
    title: rootTitle,
    withinPaperClosure: input.rootSeed.withinPaperClosure
  };

  return freezeDocument({
    annotationSettings: { autoPublic: false },
    annotations: [],
    artifactId: input.artifactId,
    literatureRecords: Object.keys(literatureRecords).length > 0 ? literatureRecords : undefined,
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
  const literatureId = paperId ? document.literatureRecords?.[paperId]?.literatureId : undefined;
  if (source.kind === "omitted_section") {
    return { kind: "section", literatureId, paperId, paperIdentity, sectionKey: source.sectionKey };
  }
  return {
    kind: "selected_passage",
    ...(source.evidenceIds ? { evidenceIds: [...source.evidenceIds] } : {}),
    ...(source.externalSourceIds ? { externalSourceIds: [...source.externalSourceIds] } : {}),
    excerpt: source.excerpt,
    literatureId,
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
  assertAiInterpretationSeedBoundary(input.seed);
  const source = input.source;

  const child: ThinReadingNode = {
    childIds: [],
    closureState: resolveThinReadingClosureState({
      closureState: input.seed.closureState,
      depth: parent.depth + 1,
      withinPaperClosure: input.seed.withinPaperClosure
    }),
    createdAt: input.createdAt ?? createNodeCreatedAt(childId),
    depth: parent.depth + 1,
    id: childId,
    evidence: input.seed.evidence,
    omittedSections: input.seed.omittedSections,
    paperType: input.seed.paperType,
    parentId: parent.id,
    recommendationScope: recommendationScopeForSource(document, source),
    recommendations: retainCommunityRecommendations(input.seed.recommendations),
    source,
    summary: input.seed.summary,
    supportMode: resolveThinReadingSupportMode({
      evidence: input.seed.evidence,
      supportMode: input.seed.supportMode
    }),
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
