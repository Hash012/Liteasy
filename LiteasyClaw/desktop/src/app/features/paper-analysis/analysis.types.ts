import type { Citation, RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";

export type AnalysisRunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "needs_review"
  | "running";

export type MultiPaperAnalysisPlan = {
  dimensions: string[];
  maxEvidencePerPaper: number;
  maxTotalEvidence: number;
  paperIds: string[];
  query: string;
};

export type AnalysisEvidence = {
  analysisRunId: string;
  chunkId: string;
  id: string;
  page: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  textExtraction?: "embedded" | "ocr";
  paperId: string;
  paperTitle: string;
  quote: string;
  relevance: number;
  retrievalReason: string;
  summary: string;
  terms: string[];
};

export type AnalysisClaim = {
  analysisRunId: string;
  confidence: number;
  evidenceIds: string[];
  id: string;
  stance: "contradicted" | "insufficient" | "mixed" | "supported";
  text: string;
};

export type AnalysisCoverage = {
  coveredPaperIds: string[];
  missingPaperIds: string[];
  ratio: number;
  selectedPaperIds: string[];
};

export type AnalysisRun = {
  completedAt?: string;
  coverage: AnalysisCoverage;
  createdAt: string;
  id: string;
  plan: MultiPaperAnalysisPlan;
  query: string;
  selectionSnapshotId?: string;
  status: AnalysisRunStatus;
  workspaceRevision?: number;
};

export type PreparedMultiPaperAnalysis = {
  citations: Citation[];
  evidence: AnalysisEvidence[];
  evidencePrompt: string;
  paperClaims: AnalysisClaim[];
  retrievalConfidence: number;
  run: AnalysisRun;
};

export type MultiPaperAnalysisInput = {
  createId?: (kind: "analysis" | "claim" | "evidence") => string;
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  limits?: {
    maxEvidencePerPaper?: number;
    maxTotalEvidence?: number;
  };
  now?: () => Date;
  query: string;
  selectedPapers: Paper[];
  selectionSnapshotId?: string;
  signal?: AbortSignal;
  workspaceRevision?: number;
};

export type CompletedMultiPaperAnalysis = PreparedMultiPaperAnalysis & {
  claims: AnalysisClaim[];
  run: AnalysisRun & { completedAt: string };
};
