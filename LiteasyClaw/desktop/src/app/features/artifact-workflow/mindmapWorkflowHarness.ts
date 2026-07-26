import type {
  MindmapArtifact,
  MindmapNode,
  MindmapSelectedPaperSource,
  MindmapSourceCatalog,
  MindmapWorkflowTraceStepKind,
  MindmapVerificationReport,
  MindmapWorkflowResult
} from "./mindmapArtifact.types";
import { createArtifactWorkflowHarness } from "./artifactWorkflowHarness";
import {
  createDeterministicExternalKnowledgeProvider,
  type ExternalKnowledgeProvider
} from "./externalKnowledgeProvider";
import { repairMindmapArtifact } from "./mindmapArtifactRepairer";
import { verifyMindmapArtifact } from "./mindmapArtifactVerifier";
import type { AnalysisEvidence, PreparedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { Paper } from "../workspace/workspace.types";

export type RunMindmapArtifactWorkflowInput = {
  artifactId: string;
  generatedAnswer: string;
  prepared: PreparedMultiPaperAnalysis;
  question: string;
  runId: string;
  selectedPapers: Paper[];
  externalKnowledgeProvider?: ExternalKnowledgeProvider;
  now?: () => Date;
};

export async function runMindmapArtifactWorkflow(
  input: RunMindmapArtifactWorkflowInput
): Promise<MindmapWorkflowResult> {
  const now = input.now ?? (() => new Date());
  const harness = createArtifactWorkflowHarness<
    MindmapWorkflowTraceStepKind,
    "liteasy.mindmap-workflow-trace/v1"
  >({
    artifactId: input.artifactId,
    now,
    runId: input.runId,
    tracePrefix: "mindmap-workflow",
    traceVersion: "liteasy.mindmap-workflow-trace/v1"
  });
  harness.step({
    details: {
      artifactType: "mindmap",
      selectedPaperIds: input.selectedPapers.map((paper) => paper.id)
    },
    kind: "scope",
    run: () => undefined,
    summary: "固定思维导图任务范围"
  });
  const externalKnowledgeProvider =
    input.externalKnowledgeProvider ?? createDeterministicExternalKnowledgeProvider();
  const selectedPaperSources = buildSelectedPaperSources(input.prepared.evidence);
  const externalReferences = await harness.step({
    details: {
      selectedEvidenceCount: selectedPaperSources.length
    },
    kind: "external_lookup",
    run: () => externalKnowledgeProvider.lookup({
      question: input.question,
      terms: collectEvidenceTerms(input.prepared.evidence),
      timeoutMs: 1200
    }),
    summary: "补充外部知识来源"
  });
  const lastExternalStep = harness.trace().steps[harness.trace().steps.length - 1];
  if (lastExternalStep?.details) {
    lastExternalStep.details.externalReferenceCount = externalReferences.length;
  }
  const sources: MindmapSourceCatalog = {
    externalReferences,
    inferences: [],
    selectedPapers: selectedPaperSources
  };
  const createdAt = now().toISOString();
  const initialVerification: MindmapVerificationReport = {
    checkedAt: createdAt,
    errors: [],
    repairable: false,
    status: "review",
    warnings: []
  };
  const draft: MindmapArtifact = {
    artifactId: input.artifactId,
    createdAt,
    root: buildMindmapRoot({
      generatedAnswer: input.generatedAnswer,
      prepared: input.prepared,
      question: input.question,
      selectedPapers: input.selectedPapers,
      sources
    }),
    runId: input.runId,
    sources,
    title: input.question.trim() || "文献思维导图",
    verification: initialVerification,
    version: "liteasy.mindmap-artifact/v1"
  };
  harness.step({
    details: {
      rootChildCount: draft.root.children.length,
      sourceRefCount: draft.sources.selectedPapers.length + draft.sources.externalReferences.length
    },
    kind: "draft",
    run: () => undefined,
    summary: "构造思维导图草稿"
  });
  const verification = harness.step({
    details: {},
    kind: "verification",
    run: () => verifyMindmapArtifact(draft, {
      now,
      selectedPaperIds: input.selectedPapers.map((paper) => paper.id)
    }),
    summary: "确定性校验通过"
  });
  const verificationStep = harness.trace().steps[harness.trace().steps.length - 1];
  verificationStep.details = {
    errorCount: verification.errors.length,
    warningCount: verification.warnings.length
  };
  if (verification.status !== "pass") {
    verificationStep.status = "blocked";
    verificationStep.summary = "确定性校验未通过";
  }
  let finalVerification = verification;
  let finalDraft: MindmapArtifact = {
    ...draft,
    verification
  };

  if (verification.status !== "pass" && verification.repairable) {
    const repairResult = harness.step({
      details: {
        errorCodes: verification.errors.map((issue) => issue.code),
        repairRounds: 1
      },
      kind: "repair",
      run: () => repairMindmapArtifact(finalDraft, verification),
      summary: "尝试安全自动修复"
    });
    const repairStep = harness.trace().steps[harness.trace().steps.length - 1];
    repairStep.details = {
      ...(repairStep.details ?? {}),
      appliedRepairCount: repairResult.appliedRepairs.length,
      unresolvedIssueCodes: repairResult.unresolvedIssueCodes
    };
    finalDraft = repairResult.artifact;
    finalVerification = verifyMindmapArtifact(finalDraft, {
      now,
      selectedPaperIds: input.selectedPapers.map((paper) => paper.id)
    });
    finalDraft = {
      ...finalDraft,
      verification: finalVerification
    };
    if (finalVerification.status === "pass") {
      repairStep.status = "completed";
      repairStep.summary = "安全自动修复后审计通过";
    } else {
      repairStep.status = "blocked";
      repairStep.summary = repairResult.appliedRepairs.length > 0
        ? "安全自动修复后仍未通过审计"
        : "没有安全自动修复策略，保持草稿阻断";
    }
  }

  const workflowTrace = harness.trace();

  if (finalVerification.status === "pass") {
    return {
      artifact: finalDraft,
      status: "verified",
      workflowTrace
    };
  }

  return {
    draft: finalDraft,
    status: "blocked",
    verification: finalVerification,
    workflowTrace
  };
}

function buildSelectedPaperSources(evidence: AnalysisEvidence[]): MindmapSelectedPaperSource[] {
  return evidence.map((item) => ({
    evidenceId: item.id,
    paperId: item.paperId,
    paperTitle: item.paperTitle,
    refId: paperSourceRef(item.id),
    snippet: item.quote
  }));
}

function collectEvidenceTerms(evidence: AnalysisEvidence[]): string[] {
  return Array.from(new Set(evidence.flatMap((item) => item.terms))).filter(Boolean);
}

function buildMindmapRoot(input: {
  generatedAnswer: string;
  prepared: PreparedMultiPaperAnalysis;
  question: string;
  selectedPapers: Paper[];
  sources: MindmapSourceCatalog;
}): MindmapNode {
  const paperNodes = input.selectedPapers.map((paper) => buildPaperNode(paper, input.prepared.evidence));
  const externalNode = buildExternalKnowledgeNode(input.sources);
  return {
    children: externalNode ? [...paperNodes, externalNode] : paperNodes,
    confidence: input.prepared.retrievalConfidence >= 0.75 ? "high" : "medium",
    id: "root",
    label: input.question.trim() || "文献思维导图",
    nodeType: "topic",
    sourceRefs: [],
    summary: input.generatedAnswer
  };
}

function buildPaperNode(paper: Paper, evidence: AnalysisEvidence[]): MindmapNode {
  const paperEvidence = evidence.filter((item) => item.paperId === paper.id);

  return {
    children:
      paperEvidence.length > 0
        ? paperEvidence.map((item) => ({
            children: [],
            confidence: item.relevance >= 0.75 ? "high" : "medium",
            id: `node-evidence-${item.id}`,
            label: item.summary,
            nodeType: "paper_claim",
            sourceRefs: [paperSourceRef(item.id)],
            summary: item.quote
          }))
        : [
            {
              children: [],
              confidence: "low",
              id: `node-gap-${paper.id}`,
              label: "该文献缺少可审计证据",
              nodeType: "open_question",
              sourceRefs: []
            }
          ],
    confidence: paperEvidence.length > 0 ? "high" : "low",
    id: `node-paper-${paper.id}`,
    label: paper.title,
    nodeType: "topic",
    sourceRefs: paperEvidence.map((item) => paperSourceRef(item.id))
  };
}

function buildExternalKnowledgeNode(sources: MindmapSourceCatalog): MindmapNode | undefined {
  if (sources.externalReferences.length === 0) {
    return undefined;
  }

  return {
    children: sources.externalReferences.map((source) => ({
      children: [],
      confidence: source.authorityLevel === "high" ? "high" : "medium",
      id: `node-${source.refId.replace(/[^a-z0-9_-]+/gi, "-")}`,
      label: source.sourceTitle,
      nodeType: "concept",
      sourceRefs: [source.refId],
      summary: source.summary
    })),
    confidence: "high",
    id: "node-external-knowledge",
    label: "外部补充知识",
    nodeType: "topic",
    sourceRefs: sources.externalReferences.map((source) => source.refId)
  };
}

function paperSourceRef(evidenceId: string): string {
  return `paper:${evidenceId}`;
}
