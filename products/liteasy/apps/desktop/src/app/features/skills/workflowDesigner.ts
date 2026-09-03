import type { JsonSchema } from "./actionRegistry";
import { validateJsonSchemaValue } from "../agent-runtime/planValidator";
import {
  getWorkflowOperatorDefinitions,
  hasWorkflowSkill,
  loadWorkflowSkill,
  parseWorkflowSkillPackage,
  registerWorkflowSkill
} from "./workflowSkillRegistry";
import type {
  WorkflowSkillExecutionResult,
  WorkflowSkillPackageV1
} from "./workflowSkill.types";

export const USER_WORKFLOW_SNAPSHOT_VERSION = "liteasy.user-workflows/v1" as const;

export type SuccessfulWorkflowRun = {
  completedAt: string;
  input: Record<string, unknown>;
  resultSummary: string;
  runId: string;
  skillId: string;
  skillVersion: string;
  trace: WorkflowSkillExecutionResult["trace"];
};

export type WorkflowReplayCase = {
  caseId: string;
  expectedOperatorIds: string[];
  input: Record<string, unknown>;
  outputSchema: JsonSchema;
  version: "liteasy.workflow-replay/v1";
};

export type WorkflowReplayEvaluation = {
  checks: Array<{
    id: "input_schema" | "operator_chain" | "output_schema" | "permission_closure";
    status: "passed";
  }>;
  evaluatedAt: string;
  status: "passed";
  version: "liteasy.workflow-replay-evaluation/v1";
};

export type WorkflowSkillDraft = {
  createdAt: string;
  draftId: string;
  installedAt?: string;
  package: WorkflowSkillPackageV1;
  replayCase: WorkflowReplayCase;
  replayEvaluation: WorkflowReplayEvaluation;
  sourceRunId: string;
  status: "installed" | "pending_approval";
  summary: string;
  version: "liteasy.workflow-draft/v1";
};

export type UserWorkflowSnapshot = {
  drafts: WorkflowSkillDraft[];
  packages: WorkflowSkillPackageV1[];
  savedAt: string;
  version: typeof USER_WORKFLOW_SNAPSHOT_VERSION;
};

export type UserWorkflowStore = {
  load: () => unknown | Promise<unknown>;
  save: (snapshot: UserWorkflowSnapshot) => void | Promise<void>;
};

type StrictObjectSchema = JsonSchema & { additionalProperties: false };

export type WorkflowDesignerToolDefinition = {
  description: string;
  name: "liteasy_workflow_design_from_run" | "liteasy_workflow_list_successful_runs";
  parameters: StrictObjectSchema;
  strict: true;
};

export type WorkflowDesignerToolInvocation = {
  arguments: Record<string, unknown>;
  toolCallId: string;
  toolName: WorkflowDesignerToolDefinition["name"];
};

export type WorkflowDesignerToolResult =
  | {
      draft: WorkflowSkillDraft;
      ok: true;
      toolCallId: string;
    }
  | {
      ok: true;
      runs: Array<Pick<
        SuccessfulWorkflowRun,
        "completedAt" | "resultSummary" | "runId" | "skillId" | "skillVersion"
      >>;
      toolCallId: string;
    };

export type WorkflowDesignerRuntime = {
  getDraft: (draftId: string) => Promise<WorkflowSkillDraft | null>;
  installDraft: (draftId: string) => Promise<string>;
  invokeTool: (invocation: WorkflowDesignerToolInvocation) => Promise<WorkflowDesignerToolResult>;
  listInstalled: () => Promise<WorkflowSkillPackageV1[]>;
  recordSuccessfulRun: (run: SuccessfulWorkflowRun) => void;
  restore: () => Promise<void>;
};

type WorkflowDesignerOptions = {
  createId?: (prefix: "draft" | "replay") => string;
  now?: () => Date;
  store?: UserWorkflowStore;
};

const listRunsSchema: StrictObjectSchema = {
  additionalProperties: false,
  properties: {},
  type: "object"
};

const designFromRunSchema: StrictObjectSchema = {
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    idHint: { type: "string" },
    instructions: { type: "string" },
    name: { type: "string" },
    sourceRunId: { type: "string" }
  },
  required: ["description", "instructions", "name", "sourceRunId"],
  type: "object"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeUserSkillId(idHint: string | undefined, name: string) {
  const normalized = (idHint ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 90);
  const suffix = normalized || `workflow-${stableHash(name)}`;
  return suffix.startsWith("user.") ? suffix : `user.${suffix}`;
}

function requiredString(
  value: unknown,
  label: string,
  maximumLength: number
) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`workflow_designer_${label}_required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new Error(`workflow_designer_${label}_too_long`);
  }
  return normalized;
}

function validateArgumentKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`workflow_designer_arguments_invalid: ${unexpected.join(", ")}`);
  }
}

function createReplayInput(
  schema: JsonSchema,
  sourceInput: Record<string, unknown>
) {
  const input: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    const property = schema.properties?.[key];
    if (key === "instruction") {
      input[key] = "请按这个可复用流程分析当前论文";
    } else if (property?.enum?.length) {
      input[key] = property.enum.includes(sourceInput[key])
        ? sourceInput[key]
        : property.enum[0];
    } else if (property?.type === "boolean") {
      input[key] = false;
    } else if (property?.type === "number") {
      input[key] = 0;
    } else if (property?.type === "array") {
      input[key] = [];
    } else if (property?.type === "object") {
      input[key] = {};
    } else {
      input[key] = "replay-value";
    }
  }
  return input;
}

function evaluateReplayCase(
  workflowPackage: WorkflowSkillPackageV1,
  replayCase: WorkflowReplayCase,
  evaluatedAt: string
): WorkflowReplayEvaluation {
  const operatorIds = workflowPackage.manifest.steps.map(
    (step) => `${step.operator.id}@${step.operator.version}`
  );
  if (!validateJsonSchemaValue(
    replayCase.input,
    workflowPackage.manifest.inputSchema,
    "workflow_replay_input"
  ).valid) {
    throw new Error("workflow_replay_input_invalid");
  }
  if (JSON.stringify(replayCase.expectedOperatorIds) !== JSON.stringify(operatorIds)) {
    throw new Error("workflow_replay_operator_chain_invalid");
  }
  if (
    JSON.stringify(replayCase.outputSchema) !==
    JSON.stringify(workflowPackage.manifest.outputSchema)
  ) {
    throw new Error("workflow_replay_output_schema_invalid");
  }
  const definitions = getWorkflowOperatorDefinitions();
  const operatorPermissions = new Set<string>();
  for (const step of workflowPackage.manifest.steps) {
    const operator = definitions.find(
      (candidate) =>
        candidate.id === step.operator.id && candidate.version === step.operator.version
    );
    if (!operator) throw new Error("workflow_replay_operator_chain_invalid");
    operator.permissions.forEach((permission) => operatorPermissions.add(permission));
  }
  if ([...operatorPermissions].some(
    (permission) => !workflowPackage.manifest.permissions.includes(permission)
  )) {
    throw new Error("workflow_replay_permission_closure_invalid");
  }
  return {
    checks: [
      { id: "input_schema", status: "passed" },
      { id: "operator_chain", status: "passed" },
      { id: "output_schema", status: "passed" },
      { id: "permission_closure", status: "passed" }
    ],
    evaluatedAt,
    status: "passed",
    version: "liteasy.workflow-replay-evaluation/v1"
  };
}

function parseDraft(value: unknown): WorkflowSkillDraft | null {
  if (
    !isRecord(value) ||
    value.version !== "liteasy.workflow-draft/v1" ||
    typeof value.draftId !== "string" ||
    typeof value.sourceRunId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.summary !== "string" ||
    (value.status !== "installed" && value.status !== "pending_approval") ||
    !isRecord(value.replayCase)
    || !isRecord(value.replayEvaluation)
  ) {
    return null;
  }
  let workflowPackage: WorkflowSkillPackageV1;
  try {
    workflowPackage = parseWorkflowSkillPackage(value.package);
  } catch {
    return null;
  }
  const replayCase = value.replayCase;
  const replayEvaluation = value.replayEvaluation;
  if (
    replayCase.version !== "liteasy.workflow-replay/v1" ||
    typeof replayCase.caseId !== "string" ||
    !Array.isArray(replayCase.expectedOperatorIds) ||
    replayCase.expectedOperatorIds.some((item) => typeof item !== "string") ||
    !isRecord(replayCase.input) ||
    !isRecord(replayCase.outputSchema)
  ) {
    return null;
  }
  const expectedOperatorIds = workflowPackage.manifest.steps.map(
    (step) => `${step.operator.id}@${step.operator.version}`
  );
  if (
    JSON.stringify(replayCase.expectedOperatorIds) !== JSON.stringify(expectedOperatorIds) ||
    JSON.stringify(replayCase.outputSchema) !==
      JSON.stringify(workflowPackage.manifest.outputSchema) ||
    !validateJsonSchemaValue(
      replayCase.input,
      workflowPackage.manifest.inputSchema,
      "workflow_replay_input"
    ).valid
  ) {
    return null;
  }
  if (
    replayEvaluation.version !== "liteasy.workflow-replay-evaluation/v1" ||
    replayEvaluation.status !== "passed" ||
    typeof replayEvaluation.evaluatedAt !== "string"
  ) {
    return null;
  }
  let verifiedReplay: WorkflowReplayEvaluation;
  try {
    verifiedReplay = evaluateReplayCase(
      workflowPackage,
      replayCase as unknown as WorkflowReplayCase,
      replayEvaluation.evaluatedAt
    );
  } catch {
    return null;
  }
  return clone({
    createdAt: value.createdAt,
    draftId: value.draftId,
    ...(typeof value.installedAt === "string" ? { installedAt: value.installedAt } : {}),
    package: workflowPackage,
    replayCase: replayCase as unknown as WorkflowReplayCase,
    replayEvaluation: verifiedReplay,
    sourceRunId: value.sourceRunId,
    status: value.status,
    summary: value.summary,
    version: "liteasy.workflow-draft/v1"
  });
}

function parseSnapshot(value: unknown): UserWorkflowSnapshot | null {
  if (
    !isRecord(value) ||
    value.version !== USER_WORKFLOW_SNAPSHOT_VERSION ||
    typeof value.savedAt !== "string" ||
    !Array.isArray(value.packages) ||
    !Array.isArray(value.drafts)
  ) {
    return null;
  }
  try {
    const packages = value.packages.map(parseWorkflowSkillPackage);
    const drafts = value.drafts.map(parseDraft);
    if (drafts.some((draft) => draft === null)) return null;
    return {
      drafts: drafts as WorkflowSkillDraft[],
      packages,
      savedAt: value.savedAt,
      version: USER_WORKFLOW_SNAPSHOT_VERSION
    };
  } catch {
    return null;
  }
}

function createMemoryStore(): UserWorkflowStore {
  let snapshot: UserWorkflowSnapshot | null = null;
  return {
    load: () => clone(snapshot),
    save: (value) => {
      snapshot = clone(value);
    }
  };
}

export function createBrowserUserWorkflowStore(): UserWorkflowStore {
  const storageKey = "liteasy.user-workflows.v1";
  return {
    load() {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const value = window.localStorage.getItem(storageKey);
      return value ? JSON.parse(value) : null;
    },
    save(snapshot) {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    }
  };
}

export function createWorkflowDesignerToolCatalog(): WorkflowDesignerToolDefinition[] {
  return [
    {
      description: "列出本会话中可用于提炼 Skill 的成功工作流运行。",
      name: "liteasy_workflow_list_successful_runs",
      parameters: clone(listRunsSchema),
      strict: true
    },
    {
      description: "从一次真实成功运行提炼可复用 Workflow Skill 草案；只生成草案，不会安装。",
      name: "liteasy_workflow_design_from_run",
      parameters: clone(designFromRunSchema),
      strict: true
    }
  ];
}

export function createWorkflowDesignerRuntime(
  options: WorkflowDesignerOptions = {}
): WorkflowDesignerRuntime {
  const store = options.store ?? createMemoryStore();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((prefix) => {
    const random = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
  });
  const successfulRuns = new Map<string, SuccessfulWorkflowRun>();
  const drafts = new Map<string, WorkflowSkillDraft>();
  const installedPackages = new Map<string, WorkflowSkillPackageV1>();
  let restorePromise: Promise<void> | null = null;

  function snapshot(): UserWorkflowSnapshot {
    return {
      drafts: [...drafts.values()].map(clone),
      packages: [...installedPackages.values()].map(clone),
      savedAt: now().toISOString(),
      version: USER_WORKFLOW_SNAPSHOT_VERSION
    };
  }

  async function persist() {
    await store.save(snapshot());
  }

  async function restore() {
    if (restorePromise) return restorePromise;
    restorePromise = Promise.resolve(store.load()).then((value) => {
      if (value === null || value === undefined) return;
      const parsed = parseSnapshot(value);
      if (!parsed) throw new Error("user_workflow_snapshot_invalid");
      for (const workflowPackage of parsed.packages) {
        const { id, version } = workflowPackage.manifest;
        if (!hasWorkflowSkill(id, version)) registerWorkflowSkill(workflowPackage);
        installedPackages.set(`${id}@${version}`, clone(workflowPackage));
      }
      for (const draft of parsed.drafts) drafts.set(draft.draftId, clone(draft));
    });
    return restorePromise;
  }

  function recordSuccessfulRun(run: SuccessfulWorkflowRun) {
    const workflowPackage = loadWorkflowSkill(run.skillId, run.skillVersion);
    const expectedOperatorIds = workflowPackage.manifest.steps.map(
      (step) => `${step.operator.id}@${step.operator.version}`
    );
    const actualOperatorIds = run.trace.steps.map(
      (step) => `${step.operatorId}@${step.operatorVersion}`
    );
    if (
      !run.runId.trim() ||
      run.trace.skillId !== run.skillId ||
      run.trace.skillVersion !== run.skillVersion ||
      JSON.stringify(actualOperatorIds) !== JSON.stringify(expectedOperatorIds) ||
      !validateJsonSchemaValue(
        run.input,
        workflowPackage.manifest.inputSchema,
        "workflow_successful_run_input"
      ).valid
    ) {
      throw new Error("workflow_designer_successful_run_invalid");
    }
    successfulRuns.set(run.runId, clone(run));
    while (successfulRuns.size > 20) {
      const oldest = successfulRuns.keys().next().value as string | undefined;
      if (!oldest) break;
      successfulRuns.delete(oldest);
    }
  }

  function uniqueSkillId(idHint: string | undefined, name: string) {
    const baseId = normalizeUserSkillId(idHint, name);
    let candidate = baseId;
    let suffix = 2;
    const reserved = new Set(
      [...drafts.values()].map((draft) => draft.package.manifest.id)
    );
    while (hasWorkflowSkill(candidate, "1.0.0") || reserved.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async function designFromRun(
    invocation: WorkflowDesignerToolInvocation
  ): Promise<WorkflowDesignerToolResult> {
    await restore();
    validateArgumentKeys(invocation.arguments, [
      "description",
      "idHint",
      "instructions",
      "name",
      "sourceRunId"
    ]);
    const sourceRunId = requiredString(invocation.arguments.sourceRunId, "source_run_id", 160);
    const sourceRun = successfulRuns.get(sourceRunId);
    if (!sourceRun) throw new Error("workflow_designer_source_run_not_found");
    const name = requiredString(invocation.arguments.name, "name", 120);
    const description = requiredString(invocation.arguments.description, "description", 500);
    const instructions = requiredString(invocation.arguments.instructions, "instructions", 20_000);
    const idHint = invocation.arguments.idHint === undefined
      ? undefined
      : requiredString(invocation.arguments.idHint, "id_hint", 100);
    const sourcePackage = loadWorkflowSkill(sourceRun.skillId, sourceRun.skillVersion);
    const skillId = uniqueSkillId(idHint, name);
    const workflowPackage = parseWorkflowSkillPackage({
      instructions,
      manifest: {
        ...sourcePackage.manifest,
        description,
        id: skillId,
        name,
        version: "1.0.0"
      }
    });
    const draftId = createId("draft");
    const replayCase: WorkflowReplayCase = {
      caseId: createId("replay"),
      expectedOperatorIds: sourceRun.trace.steps.map(
        (step) => `${step.operatorId}@${step.operatorVersion}`
      ),
      input: createReplayInput(workflowPackage.manifest.inputSchema, sourceRun.input),
      outputSchema: clone(workflowPackage.manifest.outputSchema),
      version: "liteasy.workflow-replay/v1"
    };
    const createdAt = now().toISOString();
    const draft: WorkflowSkillDraft = {
      createdAt,
      draftId,
      package: workflowPackage,
      replayCase,
      replayEvaluation: evaluateReplayCase(workflowPackage, replayCase, createdAt),
      sourceRunId,
      status: "pending_approval",
      summary: `将成功运行提炼为“${name}”；沿用 ${workflowPackage.manifest.permissions.length} 项权限和 ${workflowPackage.manifest.steps.length} 个稳定步骤。`,
      version: "liteasy.workflow-draft/v1"
    };
    drafts.set(draftId, clone(draft));
    await persist();
    return {
      draft: clone(draft),
      ok: true,
      toolCallId: invocation.toolCallId
    };
  }

  async function invokeTool(
    invocation: WorkflowDesignerToolInvocation
  ): Promise<WorkflowDesignerToolResult> {
    requiredString(invocation.toolCallId, "tool_call_id", 160);
    if (invocation.toolName === "liteasy_workflow_list_successful_runs") {
      validateArgumentKeys(invocation.arguments, []);
      return {
        ok: true,
        runs: [...successfulRuns.values()].map((run) => ({
          completedAt: run.completedAt,
          resultSummary: run.resultSummary,
          runId: run.runId,
          skillId: run.skillId,
          skillVersion: run.skillVersion
        })),
        toolCallId: invocation.toolCallId
      };
    }
    if (invocation.toolName !== "liteasy_workflow_design_from_run") {
      throw new Error("workflow_designer_tool_not_found");
    }
    return designFromRun(invocation);
  }

  async function installDraft(draftId: string) {
    await restore();
    const draft = drafts.get(draftId);
    if (!draft) throw new Error("workflow_draft_not_found");
    if (draft.status === "installed") {
      return `工作流“${draft.package.manifest.name}”已安装。`;
    }
    const workflowPackage = parseWorkflowSkillPackage(draft.package);
    evaluateReplayCase(workflowPackage, draft.replayCase, now().toISOString());
    const { id, version } = workflowPackage.manifest;
    if (!hasWorkflowSkill(id, version)) registerWorkflowSkill(workflowPackage);
    installedPackages.set(`${id}@${version}`, clone(workflowPackage));
    drafts.set(draftId, {
      ...draft,
      installedAt: now().toISOString(),
      status: "installed"
    });
    await persist();
    return `已安装工作流“${workflowPackage.manifest.name}” (${id}@${version})。`;
  }

  return {
    async getDraft(draftId) {
      await restore();
      const draft = drafts.get(draftId);
      return draft ? clone(draft) : null;
    },
    installDraft,
    invokeTool,
    async listInstalled() {
      await restore();
      return [...installedPackages.values()].map(clone);
    },
    recordSuccessfulRun,
    restore
  };
}
