export type MindmapAuthorityLevel = "high" | "medium" | "low";
export type MindmapConfidence = "high" | "medium" | "low";

export type MindmapSelectedPaperSource = {
  evidenceId: string;
  paperId: string;
  paperTitle: string;
  refId: string;
  snippet: string;
};

export type MindmapExternalReferenceSource = {
  authorityLevel: MindmapAuthorityLevel;
  reason: "background" | "concept_definition" | "method_lineage" | "missing_link";
  refId: string;
  sourceTitle: string;
  sourceUrl?: string;
  summary: string;
};

export type MindmapInferenceSource = {
  confidence: MindmapConfidence;
  rationale: string;
  refId: string;
};

export type MindmapSourceCatalog = {
  externalReferences: MindmapExternalReferenceSource[];
  inferences: MindmapInferenceSource[];
  selectedPapers: MindmapSelectedPaperSource[];
};

export type MindmapNodeType =
  | "comparison"
  | "concept"
  | "conflict"
  | "evidence"
  | "inference"
  | "method"
  | "open_question"
  | "paper_claim"
  | "topic";

export type MindmapNode = {
  children: MindmapNode[];
  confidence: MindmapConfidence;
  id: string;
  label: string;
  nodeType: MindmapNodeType;
  sourceRefs: string[];
  summary?: string;
};

export type MindmapVerificationIssue = {
  code:
    | "critical_fact_without_source"
    | "external_low_authority_main_claim"
    | "invalid_structure"
    | "missing_selected_paper_coverage"
    | "source_ref_not_found";
  message: string;
  nodeId?: string;
};

export type MindmapVerificationReport = {
  checkedAt: string;
  errors: MindmapVerificationIssue[];
  repairable: boolean;
  status: "fail" | "pass" | "review";
  warnings: MindmapVerificationIssue[];
};

export type MindmapWorkflowTraceStepKind =
  | "scope"
  | "external_lookup"
  | "draft"
  | "repair"
  | "verification";

export type MindmapWorkflowTraceStepStatus =
  | "blocked"
  | "completed";

export type MindmapWorkflowTraceStep = {
  completedAt: string;
  details?: Record<string, number | string | string[]>;
  kind: MindmapWorkflowTraceStepKind;
  startedAt: string;
  status: MindmapWorkflowTraceStepStatus;
  stepId: string;
  summary: string;
};

export type MindmapWorkflowTrace = {
  artifactId: string;
  internalOnly: true;
  runId: string;
  steps: MindmapWorkflowTraceStep[];
  traceId: string;
  version: "liteasy.mindmap-workflow-trace/v1";
};

export type MindmapArtifact = {
  artifactId: string;
  createdAt: string;
  root: MindmapNode;
  runId: string;
  sources: MindmapSourceCatalog;
  title: string;
  verification: MindmapVerificationReport;
  version: "liteasy.mindmap-artifact/v1";
};

export type MindmapWorkflowResult =
  | {
      artifact: MindmapArtifact;
      status: "verified";
      workflowTrace: MindmapWorkflowTrace;
    }
  | {
      draft: MindmapArtifact;
      status: "blocked";
      verification: MindmapVerificationReport;
      workflowTrace: MindmapWorkflowTrace;
    };

export type MindmapArtifactWorkflowMetadata =
  | {
      mindmap: MindmapArtifact;
      status: "verified";
      verification: MindmapVerificationReport;
      workflowTrace?: MindmapWorkflowTrace;
    }
  | {
      mindmap: MindmapArtifact;
      status: "blocked";
      verification: MindmapVerificationReport;
      workflowTrace?: MindmapWorkflowTrace;
    };
