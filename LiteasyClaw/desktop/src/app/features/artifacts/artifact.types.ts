import type { UIDslDocument } from "../generative-ui/generativeUi.types";
import type { AgentCitation } from "../agent-api/agentApi.types";
import type {
  MindmapArtifact,
  MindmapVerificationReport
} from "../artifact-workflow/mindmapArtifact.types";
import type { CompletedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { IntuitionGraphDocument } from "../intuition-graph/intuitionGraph.types";
import type { ThinReadingDocument } from "../thin-reading/thinReading.types";
import type { ThinReadingBranchRecoverySnapshot } from "./artifactTaskRecovery";

export type ArtifactTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ArtifactType = "comparison_table" | "layered_graph" | "mindmap" | "ppt" | "skill_doc" | "thin_reading" | "tree";
export type ArtifactTaskStage =
  | "waiting_for_import"
  | "preparing_context"
  | "retrieving_evidence"
  | "generating_answer"
  | "auditing_answer"
  | "structuring_artifact"
  | "saving_result"
  | "thin_reading_parsing_document"
  | "thin_reading_planning"
  | "thin_reading_retrieving_evidence"
  | "thin_reading_retrieving_external_knowledge"
  | "thin_reading_generating_root"
  | "thin_reading_generating_branch"
  | "thin_reading_repairing_trace"
  | "thin_reading_validating"
  | "thin_reading_saving"
  | "completed"
  | "failed"
  | "cancelled";

export type ArtifactOutlineNode = {
  evidenceIds?: string[];
  id: string;
  kind: "root" | "paper" | "section" | "term" | "evidence" | "gap";
  label: string;
  parentId?: string;
};

export type ArtifactTask = {
  agentRunId?: string;
  artifactId?: string;
  failure?: ArtifactTaskFailure;
  id: string;
  message: string;
  partialAnswer?: string;
  partialOutlineNodes?: ArtifactOutlineNode[];
  progress: number;
  recoveredAfterRestart?: boolean;
  stage: ArtifactTaskStage;
  thinReadingBranchRecovery?: ThinReadingBranchRecoverySnapshot;
  type: ArtifactType;
  status: ArtifactTaskStatus;
};

export type ArtifactTaskFailure = {
  endpoint?: string;
  failedStage: ArtifactTaskStage;
  message: string;
  model?: string;
  occurredAt: string;
  provider?: string;
  recovery: string[];
};

export type ArtifactPreview = {
  nodes: string[];
  rootLabel: string;
};

export type ArtifactPaperRef = {
  id: string;
  title: string;
};

export type ArtifactRegenerationRequest = {
  artifactId: string;
  artifactType: Exclude<ArtifactType, "skill_doc">;
  papers: ArtifactPaperRef[];
  supplementalContext: string;
};

export type ArtifactTab = {
  agentRunId?: string;
  analysis?: CompletedMultiPaperAnalysis;
  answer?: string;
  artifactId: string;
  citations?: AgentCitation[];
  createdAt?: string;
  intuitionGraph?: IntuitionGraphDocument;
  markdown?: string;
  mindmapArtifact?: MindmapArtifact;
  outlineMarkdown?: string;
  outlineNodes?: ArtifactOutlineNode[];
  papers?: ArtifactPaperRef[];
  regeneratedFromArtifactId?: string;
  sourcePath?: string;
  supplementalContext?: string;
  thinReadingDocument?: ThinReadingDocument;
  preview?: ArtifactPreview;
  resultPath?: string;
  title: string;
  type: ArtifactType;
  uiDsl?: UIDslDocument;
  verification?: MindmapVerificationReport;
};

export type AgentArtifactResult = {
  agent: {
    apiVersion: string;
    runId: string;
    sessionId: string;
    status: "completed";
  };
  analysis?: CompletedMultiPaperAnalysis;
  answer: string;
  artifactId: string;
  artifactType: Exclude<ArtifactType, "skill_doc">;
  citations: AgentCitation[];
  createdAt: string;
  intuitionGraph?: IntuitionGraphDocument;
  mindmapArtifact?: MindmapArtifact;
  outlineMarkdown?: string;
  outlineNodes?: ArtifactOutlineNode[];
  papers: ArtifactPaperRef[];
  regeneratedFromArtifactId?: string;
  supplementalContext?: string;
  thinReadingDocument?: ThinReadingDocument;
  title: string;
  uiDsl?: UIDslDocument;
  verification?: MindmapVerificationReport;
  version: "liteasy.agent-artifact/v1";
};
