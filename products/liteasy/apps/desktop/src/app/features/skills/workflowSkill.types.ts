import type { AgentArtifactType } from "../agent-api/agentApi.types";
import type { ActionContext, ActionResult, JsonSchema } from "./actionRegistry";

export type WorkflowSkillBindingV1 =
  | {
      path: string;
      source: "input";
    }
  | {
      source: "literal";
      value: unknown;
    }
  | {
      path?: string;
      source: "step";
      stepId: string;
    };

export type WorkflowSkillStepV1 = {
  id: string;
  input: Record<string, WorkflowSkillBindingV1>;
  operator: {
    id: string;
    version: string;
  };
};

export type WorkflowSkillManifestV1 = {
  abiVersion: "liteasy.workflow-skill/v1";
  description: string;
  id: string;
  inputSchema: JsonSchema;
  name: string;
  output: WorkflowSkillBindingV1;
  outputSchema: JsonSchema;
  permissions: string[];
  steps: WorkflowSkillStepV1[];
  version: string;
};

export type WorkflowSkillPackageV1 = {
  instructions: string;
  manifest: WorkflowSkillManifestV1;
};

export type WorkflowSkillSummary = Pick<
  WorkflowSkillManifestV1,
  "description" | "id" | "inputSchema" | "name" | "permissions" | "version"
> & {
  operatorIds: string[];
};

export type WorkflowSkillInvocation = {
  input: Record<string, unknown>;
  skillId: string;
  version?: string;
};

export type WorkflowOperatorDefinition = {
  description: string;
  id: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: string[];
  version: string;
};

export type WorkflowArtifactAnalysisInput = {
  artifactType: AgentArtifactType;
  instruction: string;
  workflowInstructions: string;
};

export type WorkflowOperatorRuntime = {
  actionContext?: ActionContext;
  now?: () => Date;
  runArtifactAnalysis?: (
    input: WorkflowArtifactAnalysisInput
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export type WorkflowSkillExecutionStep = {
  completedAt: string;
  id: string;
  operatorId: string;
  operatorVersion: string;
};

export type WorkflowSkillExecutionResult<T = unknown> = {
  output: T;
  trace: {
    skillId: string;
    skillVersion: string;
    steps: WorkflowSkillExecutionStep[];
    version: "liteasy.workflow-trace/v1";
  };
};

export type ActionWorkflowExecutionResult = WorkflowSkillExecutionResult<ActionResult>;
