import type { AgentArtifactType } from "../agent-api/agentApi.types";
import { validateJsonSchemaValue } from "../agent-runtime/planValidator";
import { settingsRegistry } from "../settings/settingsRegistry";
import {
  executeAction,
  type ActionInvocation,
  type ActionResult,
  type JsonSchema
} from "./actionRegistry";
import type {
  WorkflowOperatorDefinition,
  WorkflowOperatorRuntime,
  WorkflowSkillBindingV1,
  WorkflowSkillExecutionResult,
  WorkflowSkillInvocation,
  WorkflowSkillManifestV1,
  WorkflowSkillPackageV1,
  WorkflowSkillSummary
} from "./workflowSkill.types";

export const THIN_READING_WORKFLOW_SKILL_ID = "liteasy.thin-reading";
export const MULTIMODAL_WORKFLOW_SKILL_ID = "liteasy.multimodal-artifact";

const artifactTypes = [
  "comparison_table",
  "layered_graph",
  "mindmap",
  "ppt",
  "thin_reading",
  "tree"
] as const satisfies readonly AgentArtifactType[];

const actionResultSchema: JsonSchema = {
  additionalProperties: false,
  properties: {
    message: { type: "string" }
  },
  required: ["message"],
  type: "object"
};

const agentResultSchema: JsonSchema = {
  additionalProperties: true,
  properties: {
    message: { type: "string" }
  },
  required: ["message"],
  type: "object"
};

const operatorDefinitions = [
  {
    description: "通过 actionRegistry 更新一个 Liteasy 设置。",
    id: "liteasy.settings.adjust",
    inputSchema: {
      additionalProperties: false,
      properties: {
        target: {
          enum: Object.keys(settingsRegistry),
          type: "string"
        },
        value: { type: ["boolean", "string"] }
      },
      required: ["target", "value"],
      type: "object"
    },
    outputSchema: actionResultSchema,
    permissions: ["settings.write"],
    version: "1.0.0"
  },
  {
    description: "通过 actionRegistry 为当前选中文献集启动产物生成。",
    id: "liteasy.artifact.generate",
    inputSchema: {
      additionalProperties: false,
      properties: {
        artifactType: { enum: artifactTypes, type: "string" },
        source: { enum: ["selected_document_set"], type: "string" }
      },
      required: ["artifactType", "source"],
      type: "object"
    },
    outputSchema: actionResultSchema,
    permissions: ["artifact.write"],
    version: "1.0.0"
  },
  {
    description: "通过 actionRegistry 打开当前组织的共享文献库。",
    id: "liteasy.organization.open-shared-library",
    inputSchema: {
      additionalProperties: false,
      properties: {
        source: { enum: ["organization_space"], type: "string" }
      },
      required: ["source"],
      type: "object"
    },
    outputSchema: actionResultSchema,
    permissions: ["organization.read"],
    version: "1.0.0"
  },
  {
    description: "调用 Liteasy 受控论文分析端口，生成一个有证据约束的产物。",
    id: "liteasy.agent.artifact-analysis",
    inputSchema: {
      additionalProperties: false,
      properties: {
        artifactType: { enum: artifactTypes, type: "string" },
        instruction: { type: "string" }
      },
      required: ["artifactType", "instruction"],
      type: "object"
    },
    outputSchema: agentResultSchema,
    permissions: ["artifact.write", "network.retrieve", "paper.figure.read", "paper.read"],
    version: "1.0.0"
  }
] as const satisfies readonly WorkflowOperatorDefinition[];

const operatorsByKey = new Map(
  operatorDefinitions.map((operator) => [
    `${operator.id}@${operator.version}`,
    operator as WorkflowOperatorDefinition
  ])
);
const workflowPackages = new Map<string, WorkflowSkillPackageV1>();

function workflowKey(id: string, version: string) {
  return `${id}@${version}`;
}

function isStableId(value: string) {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u.test(value);
}

function isVersion(value: string) {
  return /^\d+\.\d+\.\d+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isJsonSchema(value: unknown, depth = 0): value is JsonSchema {
  if (!isRecord(value) || depth > 20) return false;
  const schemaTypes = ["array", "boolean", "number", "object", "string"];
  const types = Array.isArray(value.type) ? value.type : [value.type];
  if (
    types.length === 0 ||
    types.some((type) => typeof type !== "string" || !schemaTypes.includes(type))
  ) {
    return false;
  }
  if (
    value.additionalProperties !== undefined &&
    typeof value.additionalProperties !== "boolean"
  ) {
    return false;
  }
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !isJsonValue(value.enum))) {
    return false;
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string"))
  ) {
    return false;
  }
  if (value.items !== undefined && !isJsonSchema(value.items, depth + 1)) return false;
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) return false;
    if (Object.values(value.properties).some((schema) => !isJsonSchema(schema, depth + 1))) {
      return false;
    }
  }
  return Object.keys(value).every((key) => [
    "additionalProperties",
    "enum",
    "items",
    "properties",
    "required",
    "type"
  ].includes(key));
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function cloneBinding(binding: WorkflowSkillBindingV1): WorkflowSkillBindingV1 {
  if (binding.source === "literal") {
    return {
      source: "literal",
      value: structuredClone(binding.value)
    };
  }
  return { ...binding };
}

function cloneManifest(manifest: WorkflowSkillManifestV1): WorkflowSkillManifestV1 {
  return {
    ...manifest,
    inputSchema: structuredClone(manifest.inputSchema),
    output: cloneBinding(manifest.output),
    outputSchema: structuredClone(manifest.outputSchema),
    permissions: [...manifest.permissions],
    steps: manifest.steps.map((step) => ({
      ...step,
      input: Object.fromEntries(
        Object.entries(step.input).map(([key, binding]) => [key, cloneBinding(binding)])
      ),
      operator: { ...step.operator }
    }))
  };
}

function clonePackage(workflowPackage: WorkflowSkillPackageV1): WorkflowSkillPackageV1 {
  return {
    instructions: workflowPackage.instructions,
    manifest: cloneManifest(workflowPackage.manifest)
  };
}

function assertBinding(
  binding: unknown,
  availableStepIds: ReadonlySet<string>,
  label: string
): asserts binding is WorkflowSkillBindingV1 {
  if (!isRecord(binding)) {
    throw new Error(`${label}_binding_invalid`);
  }
  if (binding.source === "input") {
    if (typeof binding.path !== "string" || !binding.path.trim()) {
      throw new Error(`${label}_binding_invalid`);
    }
    if (Object.keys(binding).some((key) => !["path", "source"].includes(key))) {
      throw new Error(`${label}_binding_invalid`);
    }
    return;
  }
  if (binding.source === "literal") {
    if (
      !("value" in binding) ||
      !isJsonValue(binding.value) ||
      Object.keys(binding).some((key) => !["source", "value"].includes(key))
    ) {
      throw new Error(`${label}_binding_invalid`);
    }
    return;
  }
  if (binding.source === "step") {
    if (
      typeof binding.stepId !== "string" ||
      !availableStepIds.has(binding.stepId) ||
      (binding.path !== undefined && typeof binding.path !== "string") ||
      Object.keys(binding).some((key) => !["path", "source", "stepId"].includes(key))
    ) {
      throw new Error(`${label}_step_reference_invalid`);
    }
    return;
  }
  throw new Error(`${label}_binding_invalid`);
}

function assertWorkflowPackage(
  workflowPackage: unknown
): asserts workflowPackage is WorkflowSkillPackageV1 {
  if (!isRecord(workflowPackage) || !isRecord(workflowPackage.manifest)) {
    throw new Error("workflow_skill_manifest_invalid");
  }
  const manifest = workflowPackage.manifest;
  if (
    Object.keys(workflowPackage).some((key) => !["instructions", "manifest"].includes(key)) ||
    Object.keys(manifest).some((key) => ![
      "abiVersion",
      "description",
      "id",
      "inputSchema",
      "name",
      "output",
      "outputSchema",
      "permissions",
      "steps",
      "version"
    ].includes(key)) ||
    manifest.abiVersion !== "liteasy.workflow-skill/v1" ||
    typeof manifest.id !== "string" ||
    !isStableId(manifest.id) ||
    typeof manifest.version !== "string" ||
    !isVersion(manifest.version) ||
    typeof manifest.name !== "string" ||
    !manifest.name.trim() ||
    typeof manifest.description !== "string" ||
    !manifest.description.trim() ||
    typeof workflowPackage.instructions !== "string" ||
    !workflowPackage.instructions.trim() ||
    !Array.isArray(manifest.steps) ||
    manifest.steps.length === 0 ||
    manifest.steps.length > 32 ||
    !Array.isArray(manifest.permissions) ||
    !isJsonSchema(manifest.inputSchema) ||
    !isJsonSchema(manifest.outputSchema)
  ) {
    throw new Error("workflow_skill_manifest_invalid");
  }
  if (
    manifest.inputSchema.type !== "object" ||
    manifest.permissions.some((permission) => typeof permission !== "string" || !isStableId(permission)) ||
    new Set(manifest.permissions).size !== manifest.permissions.length
  ) {
    throw new Error("workflow_skill_manifest_invalid");
  }

  const permissions = manifest.permissions as string[];
  const availableStepIds = new Set<string>();
  for (const step of manifest.steps) {
    if (
      !isRecord(step) ||
      typeof step.id !== "string" ||
      !isStableId(step.id) ||
      availableStepIds.has(step.id) ||
      !isRecord(step.operator) ||
      typeof step.operator.id !== "string" ||
      !isStableId(step.operator.id) ||
      typeof step.operator.version !== "string" ||
      !isVersion(step.operator.version) ||
      !isRecord(step.input) ||
      Object.keys(step).some((key) => !["id", "input", "operator"].includes(key)) ||
      Object.keys(step.operator).some((key) => !["id", "version"].includes(key))
    ) {
      throw new Error("workflow_skill_step_invalid");
    }
    const operator = operatorsByKey.get(workflowKey(step.operator.id, step.operator.version));
    if (!operator) throw new Error("workflow_skill_operator_not_found");
    const stepInput = step.input as Record<string, unknown>;
    if (
      (operator.inputSchema.required ?? []).some((key) => !(key in stepInput)) ||
      Object.keys(stepInput).some((key) => !operator.inputSchema.properties?.[key])
    ) {
      throw new Error("workflow_skill_step_input_invalid");
    }
    if (operator.permissions.some((permission) => !permissions.includes(permission))) {
      throw new Error("workflow_skill_permission_missing");
    }
    for (const binding of Object.values(stepInput)) {
      assertBinding(binding, availableStepIds, "workflow_skill_step");
    }
    availableStepIds.add(step.id);
  }
  assertBinding(manifest.output, availableStepIds, "workflow_skill_output");
}

function readPath(value: unknown, path: string | undefined, label: string): unknown {
  if (!path) return value;
  let current = value;
  for (const segment of path.split(".")) {
    if (!segment || !current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`${label}_binding_unresolved`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) throw new Error(`${label}_binding_unresolved`);
  return current;
}

function resolveBinding(
  binding: WorkflowSkillBindingV1,
  input: Record<string, unknown>,
  stepOutputs: ReadonlyMap<string, unknown>
) {
  if (binding.source === "literal") return structuredClone(binding.value);
  if (binding.source === "input") return structuredClone(readPath(input, binding.path, "workflow_input"));
  return structuredClone(readPath(
    stepOutputs.get(binding.stepId),
    binding.path,
    `workflow_step_${binding.stepId}`
  ));
}

function assertSchema(value: unknown, schema: JsonSchema, label: string) {
  const validation = validateJsonSchemaValue(value, schema, label);
  if (!validation.valid) {
    throw new Error(`workflow_schema_invalid: ${validation.errors.join("; ")}`);
  }
}

async function executeOperator(
  operator: WorkflowOperatorDefinition,
  input: Record<string, unknown>,
  runtime: WorkflowOperatorRuntime,
  workflowInstructions: string
): Promise<Record<string, unknown>> {
  if (operator.id === "liteasy.agent.artifact-analysis") {
    if (!runtime.runArtifactAnalysis) {
      throw new Error("workflow_operator_requires_artifact_analysis");
    }
    return runtime.runArtifactAnalysis({
      artifactType: input.artifactType as AgentArtifactType,
      instruction: input.instruction as string,
      workflowInstructions
    });
  }
  if (!runtime.actionContext) {
    throw new Error("workflow_operator_requires_action_context");
  }

  let invocation: ActionInvocation;
  if (operator.id === "liteasy.settings.adjust") {
    invocation = {
      actionId: "settings.update",
      input: input as Extract<ActionInvocation, { actionId: "settings.update" }>["input"]
    };
  } else if (operator.id === "liteasy.artifact.generate") {
    invocation = {
      actionId: "artifact.generate",
      input: input as Extract<ActionInvocation, { actionId: "artifact.generate" }>["input"]
    };
  } else if (operator.id === "liteasy.organization.open-shared-library") {
    invocation = {
      actionId: "organization.open_shared_library",
      input: input as Extract<ActionInvocation, { actionId: "organization.open_shared_library" }>["input"]
    };
  } else {
    throw new Error("workflow_operator_not_implemented");
  }
  return executeAction(invocation, runtime.actionContext);
}

export function parseWorkflowSkillPackage(value: unknown): WorkflowSkillPackageV1 {
  assertWorkflowPackage(value);
  return clonePackage(value);
}

export function hasWorkflowSkill(id: string, version: string) {
  return workflowPackages.has(workflowKey(id, version));
}

export function registerWorkflowSkill(workflowPackage: unknown) {
  const parsedPackage = parseWorkflowSkillPackage(workflowPackage);
  const key = workflowKey(parsedPackage.manifest.id, parsedPackage.manifest.version);
  if (workflowPackages.has(key)) throw new Error("workflow_skill_already_registered");
  workflowPackages.set(key, parsedPackage);
}

export function listWorkflowSkills(): WorkflowSkillSummary[] {
  return [...workflowPackages.values()].map(({ manifest }) => ({
    description: manifest.description,
    id: manifest.id,
    inputSchema: structuredClone(manifest.inputSchema),
    name: manifest.name,
    operatorIds: manifest.steps.map((step) => `${step.operator.id}@${step.operator.version}`),
    permissions: [...manifest.permissions],
    version: manifest.version
  }));
}

export function loadWorkflowSkill(id: string, version?: string): WorkflowSkillPackageV1 {
  const matchingVersions = [...workflowPackages.values()]
    .filter((workflowPackage) => workflowPackage.manifest.id === id)
    .map((workflowPackage) => workflowPackage.manifest.version)
    .sort(compareVersions);
  const selectedVersion = version ?? matchingVersions[matchingVersions.length - 1];
  if (!selectedVersion) throw new Error("workflow_skill_not_found");
  const workflowPackage = workflowPackages.get(workflowKey(id, selectedVersion));
  if (!workflowPackage) throw new Error("workflow_skill_not_found");
  return clonePackage(workflowPackage);
}

export async function executeWorkflowSkill<T = unknown>(
  invocation: WorkflowSkillInvocation,
  runtime: WorkflowOperatorRuntime
): Promise<WorkflowSkillExecutionResult<T>> {
  const workflowPackage = loadWorkflowSkill(invocation.skillId, invocation.version);
  const { manifest } = workflowPackage;
  assertSchema(invocation.input, manifest.inputSchema, "workflow_input");

  const stepOutputs = new Map<string, unknown>();
  const completedSteps: WorkflowSkillExecutionResult["trace"]["steps"] = [];
  for (const step of manifest.steps) {
    const operator = operatorsByKey.get(workflowKey(step.operator.id, step.operator.version));
    if (!operator) throw new Error("workflow_skill_operator_not_found");
    const stepInput = Object.fromEntries(
      Object.entries(step.input).map(([key, binding]) => [
        key,
        resolveBinding(binding, invocation.input, stepOutputs)
      ])
    );
    assertSchema(stepInput, operator.inputSchema, `workflow_step.${step.id}.input`);
    const output = await executeOperator(
      operator,
      stepInput,
      runtime,
      workflowPackage.instructions
    );
    assertSchema(output, operator.outputSchema, `workflow_step.${step.id}.output`);
    stepOutputs.set(step.id, output);
    completedSteps.push({
      completedAt: (runtime.now?.() ?? new Date()).toISOString(),
      id: step.id,
      operatorId: operator.id,
      operatorVersion: operator.version
    });
  }

  const output = resolveBinding(manifest.output, invocation.input, stepOutputs);
  assertSchema(output, manifest.outputSchema, "workflow_output");
  return {
    output: output as T,
    trace: {
      skillId: manifest.id,
      skillVersion: manifest.version,
      steps: completedSteps,
      version: "liteasy.workflow-trace/v1"
    }
  };
}

const builtinWorkflowPackages: WorkflowSkillPackageV1[] = [
  {
    instructions: "更新一个经过 Liteasy 设置注册表约束的设置项。",
    manifest: {
      abiVersion: "liteasy.workflow-skill/v1",
      description: "更新 Liteasy 设置。",
      id: "settings.adjust",
      inputSchema: operatorDefinitions[0].inputSchema,
      name: "调整设置",
      output: { source: "step", stepId: "apply-setting" },
      outputSchema: actionResultSchema,
      permissions: ["settings.write"],
      steps: [{
        id: "apply-setting",
        input: {
          target: { path: "target", source: "input" },
          value: { path: "value", source: "input" }
        },
        operator: { id: "liteasy.settings.adjust", version: "1.0.0" }
      }],
      version: "1.0.0"
    }
  },
  {
    instructions: "为当前锁定的选中文献集启动指定的结构化产物生成。",
    manifest: {
      abiVersion: "liteasy.workflow-skill/v1",
      description: "生成一个论文分析产物。",
      id: "artifact.generate",
      inputSchema: operatorDefinitions[1].inputSchema,
      name: "生成论文产物",
      output: { source: "step", stepId: "generate-artifact" },
      outputSchema: actionResultSchema,
      permissions: ["artifact.write"],
      steps: [{
        id: "generate-artifact",
        input: {
          artifactType: { path: "artifactType", source: "input" },
          source: { path: "source", source: "input" }
        },
        operator: { id: "liteasy.artifact.generate", version: "1.0.0" }
      }],
      version: "1.0.0"
    }
  },
  {
    instructions: "打开当前账号有权访问的组织共享文献库。",
    manifest: {
      abiVersion: "liteasy.workflow-skill/v1",
      description: "打开组织共享文献库。",
      id: "organization.open_shared_library",
      inputSchema: operatorDefinitions[2].inputSchema,
      name: "打开组织共享文献库",
      output: { source: "step", stepId: "open-library" },
      outputSchema: actionResultSchema,
      permissions: ["organization.read"],
      steps: [{
        id: "open-library",
        input: {
          source: { path: "source", source: "input" }
        },
        operator: { id: "liteasy.organization.open-shared-library", version: "1.0.0" }
      }],
      version: "1.0.0"
    }
  },
  {
    instructions: [
      "对当前选中文献执行证据约束的薄读。",
      "先组织论文内证据，再生成分层阅读路径；外部知识必须与论文证据分开。",
      "不得绕过 Liteasy 的来源、权限、任务和产物校验边界。"
    ].join("\n"),
    manifest: {
      abiVersion: "liteasy.workflow-skill/v1",
      description: "运行可版本化的 Liteasy Thin Read 工作流。",
      id: THIN_READING_WORKFLOW_SKILL_ID,
      inputSchema: {
        additionalProperties: false,
        properties: { instruction: { type: "string" } },
        required: ["instruction"],
        type: "object"
      },
      name: "Liteasy Thin Read",
      output: { source: "step", stepId: "analyze-thin-reading" },
      outputSchema: agentResultSchema,
      permissions: ["artifact.write", "network.retrieve", "paper.figure.read", "paper.read"],
      steps: [{
        id: "analyze-thin-reading",
        input: {
          artifactType: { source: "literal", value: "thin_reading" },
          instruction: { path: "instruction", source: "input" }
        },
        operator: { id: "liteasy.agent.artifact-analysis", version: "1.0.0" }
      }],
      version: "1.0.0"
    }
  },
  {
    instructions: [
      "把论文分析目标落实为指定的结构化多模态产物。",
      "保留引用、工作流 trace 和产物校验；不得伪造 renderer 或执行结果。"
    ].join("\n"),
    manifest: {
      abiVersion: "liteasy.workflow-skill/v1",
      description: "运行可版本化的 Liteasy 多模态产物工作流。",
      id: MULTIMODAL_WORKFLOW_SKILL_ID,
      inputSchema: {
        additionalProperties: false,
        properties: {
          artifactType: {
            enum: artifactTypes.filter((artifactType) => artifactType !== "thin_reading"),
            type: "string"
          },
          instruction: { type: "string" }
        },
        required: ["artifactType", "instruction"],
        type: "object"
      },
      name: "Liteasy Multimodal Artifact",
      output: { source: "step", stepId: "analyze-multimodal-artifact" },
      outputSchema: agentResultSchema,
      permissions: ["artifact.write", "network.retrieve", "paper.figure.read", "paper.read"],
      steps: [{
        id: "analyze-multimodal-artifact",
        input: {
          artifactType: { path: "artifactType", source: "input" },
          instruction: { path: "instruction", source: "input" }
        },
        operator: { id: "liteasy.agent.artifact-analysis", version: "1.0.0" }
      }],
      version: "1.0.0"
    }
  }
];

for (const workflowPackage of builtinWorkflowPackages) {
  registerWorkflowSkill(workflowPackage);
}

export function executeActionWorkflowSkill(
  invocation: WorkflowSkillInvocation,
  runtime: WorkflowOperatorRuntime
): Promise<WorkflowSkillExecutionResult<ActionResult>> {
  return executeWorkflowSkill<ActionResult>(invocation, runtime);
}

export function getWorkflowOperatorDefinitions(): WorkflowOperatorDefinition[] {
  return operatorDefinitions.map((operator) => ({
    ...operator,
    inputSchema: structuredClone(operator.inputSchema),
    outputSchema: structuredClone(operator.outputSchema),
    permissions: [...operator.permissions]
  }));
}
