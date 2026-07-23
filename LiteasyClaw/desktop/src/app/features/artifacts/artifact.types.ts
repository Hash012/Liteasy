import type { UIDslDocument } from "../generative-ui/generativeUi.types";
import type { AgentCitation } from "../agent-api/agentApi.types";
import type { CompletedMultiPaperAnalysis } from "../paper-analysis/analysis.types";

export type ArtifactTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ArtifactType = "comparison_table" | "mindmap" | "ppt" | "skill_doc" | "tree";
export type ArtifactTaskStage =
  | "waiting_for_import"
  | "preparing_context"
  | "retrieving_evidence"
  | "generating_answer"
  | "auditing_answer"
  | "structuring_artifact"
  | "saving_result"
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
  stage: ArtifactTaskStage;
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
  markdown?: string;
  outlineMarkdown?: string;
  outlineNodes?: ArtifactOutlineNode[];
  papers?: ArtifactPaperRef[];
  regeneratedFromArtifactId?: string;
  sourcePath?: string;
  supplementalContext?: string;
  preview?: ArtifactPreview;
  resultPath?: string;
  title: string;
  type: ArtifactType;
  uiDsl?: UIDslDocument;
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
  outlineMarkdown?: string;
  outlineNodes?: ArtifactOutlineNode[];
  papers: ArtifactPaperRef[];
  regeneratedFromArtifactId?: string;
  supplementalContext?: string;
  title: string;
  uiDsl: UIDslDocument;
  version: "liteasy.agent-artifact/v1";
};
