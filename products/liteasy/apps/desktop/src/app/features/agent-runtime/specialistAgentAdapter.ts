import type { AgentArtifactType } from "../agent-api/agentApi.types";
import type { JsonSchema } from "../skills/actionRegistry";
import {
  loadWorkflowSkill,
  MULTIMODAL_WORKFLOW_SKILL_ID,
  THIN_READING_WORKFLOW_SKILL_ID
} from "../skills/workflowSkillRegistry";

export type SpecialistAgentId = "multimodal" | "thin_reading";

export type MultimodalArtifactType = Exclude<AgentArtifactType, "thin_reading">;

type StrictObjectSchema = JsonSchema & {
  additionalProperties: false;
};

export type SpecialistAgentToolDefinition = {
  agent: {
    id: SpecialistAgentId;
    instructions: string;
    name: string;
  };
  asTool: {
    parameters: StrictObjectSchema;
    strict: true;
    toolDescription: string;
    toolName: string;
  };
  supportedArtifactTypes: readonly AgentArtifactType[];
  workflow: {
    skillId: string;
    version: string;
  };
};

export type SpecialistAgentToolInvocation = {
  arguments: Record<string, unknown>;
  specialistId: SpecialistAgentId;
  toolCallId: string;
};

export type SpecialistAgentExecutionRequest = {
  artifactType: AgentArtifactType;
  instruction: string;
  specialistId: SpecialistAgentId;
  toolCallId: string;
  workflow: {
    input: Record<string, unknown>;
    skillId: string;
    version: string;
  };
};

const multimodalArtifactTypes = [
  "comparison_table",
  "layered_graph",
  "mindmap",
  "ppt",
  "tree"
] as const satisfies readonly MultimodalArtifactType[];

const thinReadingWorkflow = loadWorkflowSkill(THIN_READING_WORKFLOW_SKILL_ID);
const multimodalWorkflow = loadWorkflowSkill(MULTIMODAL_WORKFLOW_SKILL_ID);

const thinReadingTool: SpecialistAgentToolDefinition = {
  agent: {
    id: "thin_reading",
    instructions: [
      "你是 Liteasy Thin Read specialist。",
      "只处理需要对当前选中文献做分层薄读、证据检索和阅读路径组织的子任务。",
      `始终调用 ${thinReadingWorkflow.manifest.id}@${thinReadingWorkflow.manifest.version}，不绕过本地来源与证据质量门。`,
      thinReadingWorkflow.instructions,
      "如果来源不足，让 Liteasy workflow 返回可恢复错误，由 Manager 解释给用户。"
    ].join("\n"),
    name: "Liteasy Thin Read Agent"
  },
  asTool: {
    parameters: thinReadingWorkflow.manifest.inputSchema as StrictObjectSchema,
    strict: true,
    toolDescription: thinReadingWorkflow.manifest.description,
    toolName: "liteasy_thin_reading_agent"
  },
  supportedArtifactTypes: ["thin_reading"],
  workflow: {
    skillId: thinReadingWorkflow.manifest.id,
    version: thinReadingWorkflow.manifest.version
  }
};

const multimodalTool: SpecialistAgentToolDefinition = {
  agent: {
    id: "multimodal",
    instructions: [
      "你是 Liteasy Multimodal Artifact specialist。",
      "把 Manager 给出的论文分析目标落实为指定的结构化产物。",
      `只调用 ${multimodalWorkflow.manifest.id}@${multimodalWorkflow.manifest.version}。`,
      multimodalWorkflow.instructions,
      "保留引用、分析 trace 与产物校验结果；不得伪造未执行的 renderer 或工作流。"
    ].join("\n"),
    name: "Liteasy Multimodal Agent"
  },
  asTool: {
    parameters: multimodalWorkflow.manifest.inputSchema as StrictObjectSchema,
    strict: true,
    toolDescription: multimodalWorkflow.manifest.description,
    toolName: "liteasy_multimodal_agent"
  },
  supportedArtifactTypes: multimodalArtifactTypes,
  workflow: {
    skillId: multimodalWorkflow.manifest.id,
    version: multimodalWorkflow.manifest.version
  }
};

function validateInstruction(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Specialist instruction must be a non-empty string");
  }
  const instruction = value.trim();
  if (instruction.length > 8000) {
    throw new Error("Specialist instruction exceeds 8000 characters");
  }
  return instruction;
}

function validateToolCallId(value: unknown) {
  const toolCallId = typeof value === "string" ? value.trim() : "";
  if (!toolCallId) {
    throw new Error("Specialist toolCallId must be non-empty");
  }
  return toolCallId;
}

function validateArgumentKeys(
  argumentsValue: Record<string, unknown>,
  expectedKeys: readonly string[]
) {
  const unexpectedKeys = Object.keys(argumentsValue).filter(
    (key) => !expectedKeys.includes(key)
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(`Unexpected specialist arguments: ${unexpectedKeys.join(", ")}`);
  }
}

function isMultimodalArtifactType(value: unknown): value is MultimodalArtifactType {
  return typeof value === "string" && (
    multimodalArtifactTypes as readonly string[]
  ).includes(value);
}

export function createSpecialistAgentToolCatalog(): SpecialistAgentToolDefinition[] {
  return [thinReadingTool, multimodalTool].map((definition) => ({
    agent: { ...definition.agent },
    asTool: {
      ...definition.asTool,
      parameters: {
        ...definition.asTool.parameters,
        properties: definition.asTool.parameters.properties
          ? { ...definition.asTool.parameters.properties }
          : undefined,
        required: definition.asTool.parameters.required
          ? [...definition.asTool.parameters.required]
          : undefined
      }
    },
    supportedArtifactTypes: [...definition.supportedArtifactTypes],
    workflow: { ...definition.workflow }
  }));
}

export function createSpecialistAgentExecutionRequest(
  invocation: SpecialistAgentToolInvocation
): SpecialistAgentExecutionRequest {
  const instruction = validateInstruction(invocation.arguments.instruction);
  const toolCallId = validateToolCallId(invocation.toolCallId);

  if (invocation.specialistId === "thin_reading") {
    validateArgumentKeys(invocation.arguments, ["instruction"]);
    return {
      artifactType: "thin_reading",
      instruction,
      specialistId: invocation.specialistId,
      toolCallId,
      workflow: {
        input: { instruction },
        skillId: thinReadingWorkflow.manifest.id,
        version: thinReadingWorkflow.manifest.version
      }
    };
  }

  if (invocation.specialistId !== "multimodal") {
    throw new Error(`Unknown specialist agent: ${String(invocation.specialistId)}`);
  }

  validateArgumentKeys(invocation.arguments, ["artifactType", "instruction"]);
  const artifactType = invocation.arguments.artifactType;
  if (!isMultimodalArtifactType(artifactType)) {
    throw new Error(`Unsupported multimodal artifact type: ${String(artifactType)}`);
  }
  return {
    artifactType,
    instruction,
    specialistId: invocation.specialistId,
    toolCallId,
    workflow: {
      input: { artifactType, instruction },
      skillId: multimodalWorkflow.manifest.id,
      version: multimodalWorkflow.manifest.version
    }
  };
}
