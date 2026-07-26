import type {
  MindmapArtifact,
  MindmapNode,
  MindmapSelectedPaperSource,
  MindmapSourceCatalog,
  MindmapVerificationReport,
  MindmapWorkflowResult
} from "./mindmapArtifact.types";
import {
  createDeterministicExternalKnowledgeProvider,
  type ExternalKnowledgeProvider
} from "./externalKnowledgeProvider";
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
  const externalKnowledgeProvider =
    input.externalKnowledgeProvider ?? createDeterministicExternalKnowledgeProvider();
  const selectedPaperSources = buildSelectedPaperSources(input.prepared.evidence);
  const externalReferences = await externalKnowledgeProvider.lookup({
    question: input.question,
    terms: collectEvidenceTerms(input.prepared.evidence),
    timeoutMs: 1200
  });
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
  const verification = verifyMindmapArtifact(draft, {
    now,
    selectedPaperIds: input.selectedPapers.map((paper) => paper.id)
  });
  const verifiedDraft = {
    ...draft,
    verification
  };

  if (verification.status === "pass") {
    return {
      artifact: verifiedDraft,
      status: "verified"
    };
  }

  return {
    draft: verifiedDraft,
    status: "blocked",
    verification
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
