import type {
  ArtifactFailureCode,
  ArtifactTask,
  ArtifactTaskStage,
  ArtifactType
} from "../artifacts/artifact.types";
import { presentArtifactFailure } from "../artifacts/artifactFailurePresentation";
import type { JsonSchema } from "../skills/actionRegistry";

export type AgentErrorCategory =
  | "authentication"
  | "context"
  | "document"
  | "internal"
  | "model"
  | "network"
  | "policy"
  | "validation";

export type AgentRecoveryAction = {
  actionId: string;
  label: string;
  requiresConfirmation: boolean;
};

export type AgentRuntimeError = {
  category: AgentErrorCategory;
  code: string;
  diagnosticsRef?: string;
  recoveryActions: AgentRecoveryAction[];
  retryable: boolean;
  userImpact: string;
};

export type AgentErrorEnvelope = {
  error: AgentRuntimeError;
  ok: false;
};

export type AgentActivityTaskStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "queued"
  | "running";

export type AgentActivityTask = {
  artifactId?: string;
  artifactType: ArtifactType;
  currentStage: ArtifactTaskStage;
  currentStageLabel: string;
  error?: AgentRuntimeError;
  kind: "artifact";
  label: string;
  progress: number;
  status: AgentActivityTaskStatus;
  summary: string;
  taskId: string;
};

export type AgentActivityJournal = {
  activeTaskCount: number;
  failedTaskCount: number;
  generatedAt: string;
  summary: string;
  tasks: AgentActivityTask[];
};

type StrictObjectSchema = JsonSchema & {
  additionalProperties: false;
};

export type AgentActivityToolName =
  | "liteasy_runtime_get_task_status"
  | "liteasy_runtime_list_activity";

export type AgentActivityToolDefinition = {
  description: string;
  name: AgentActivityToolName;
  parameters: StrictObjectSchema;
  strict: true;
};

export type AgentActivityToolInvocation = {
  arguments: Record<string, unknown>;
  toolCallId: string;
  toolName: AgentActivityToolName;
};

export type AgentActivityToolResult =
  | AgentErrorEnvelope
  | {
      journal: AgentActivityJournal;
      ok: true;
      toolCallId: string;
    }
  | {
      ok: true;
      task: AgentActivityTask;
      toolCallId: string;
    };

const artifactTypeLabels: Record<ArtifactType, string> = {
  comparison_table: "对比表",
  layered_graph: "分层图",
  mindmap: "思维导图",
  ppt: "演示文稿",
  skill_doc: "Skill 文档",
  thin_reading: "薄读",
  tree: "树形结构"
};

const artifactStageLabels: Record<ArtifactTaskStage, string> = {
  auditing_answer: "核对引用与证据",
  cancelled: "任务已取消",
  completed: "任务已完成",
  failed: "任务失败",
  generating_answer: "生成分析内容",
  preparing_context: "准备任务上下文",
  retrieving_evidence: "检索文献证据",
  saving_result: "保存生成结果",
  structuring_artifact: "构造结构化产物",
  thin_reading_generating_branch: "生成薄读下一层",
  thin_reading_generating_root: "生成薄读总述",
  thin_reading_parsing_document: "解析论文文本",
  thin_reading_planning: "规划薄读路径",
  thin_reading_repairing_trace: "修复证据映射",
  thin_reading_retrieving_evidence: "检索薄读证据",
  thin_reading_retrieving_external_knowledge: "检索外部文献",
  thin_reading_saving: "保存薄读产物",
  thin_reading_validating: "核验薄读证据",
  waiting_for_import: "等待 PDF 解析"
};

const failureDefaults: Record<
  ArtifactFailureCode,
  Pick<AgentRuntimeError, "category" | "recoveryActions" | "retryable">
> = {
  artifact_generation_failed: {
    category: "internal",
    recoveryActions: [{
      actionId: "retry_task",
      label: "重新提交生成任务",
      requiresConfirmation: false
    }],
    retryable: true
  },
  artifact_verification_failed: {
    category: "validation",
    recoveryActions: [{
      actionId: "review_sources_or_request",
      label: "检查来源范围或调整生成要求后重试",
      requiresConfirmation: false
    }],
    retryable: false
  },
  document_processing_failed: {
    category: "document",
    recoveryActions: [{
      actionId: "reimport_document",
      label: "重新选择或导入来源 PDF",
      requiresConfirmation: false
    }],
    retryable: false
  },
  external_retrieval_failed: {
    category: "network",
    recoveryActions: [{
      actionId: "retry_external_retrieval",
      label: "稍后重新检索外部文献",
      requiresConfirmation: false
    }],
    retryable: true
  },
  model_authentication_failed: {
    category: "authentication",
    recoveryActions: [{
      actionId: "reauthenticate",
      label: "登录或重新登录 Liteasy 账号",
      requiresConfirmation: false
    }],
    retryable: false
  },
  model_rate_limited: {
    category: "model",
    recoveryActions: [{
      actionId: "retry_later",
      label: "等待片刻后重试",
      requiresConfirmation: false
    }],
    retryable: true
  },
  model_route_unavailable: {
    category: "model",
    recoveryActions: [{
      actionId: "retry_supported_route",
      label: "稍后重试或改用当前支持的模型能力",
      requiresConfirmation: false
    }],
    retryable: true
  },
  service_unavailable: {
    category: "network",
    recoveryActions: [{
      actionId: "retry_service",
      label: "检查网络后重新提交任务",
      requiresConfirmation: false
    }],
    retryable: true
  }
};

function extractDiagnosticsRef(message: string) {
  return message.match(/\b(?:diag|trace)[_-][A-Za-z0-9._:-]+\b/)?.[0];
}

function recoveryFromText(recovery: string | undefined): AgentRecoveryAction[] | undefined {
  const label = recovery?.trim();
  return label
    ? [{
        actionId: "follow_recovery_guidance",
        label,
        requiresConfirmation: false
      }]
    : undefined;
}

export function createAgentErrorEnvelope(input: {
  category?: AgentErrorCategory;
  code?: string;
  message: string;
  recovery?: string;
  retryable?: boolean;
  userImpact?: string;
}): AgentErrorEnvelope {
  const normalized = input.message.toLowerCase();
  const diagnosticsRef = extractDiagnosticsRef(input.message);
  let error: AgentRuntimeError;

  if (/401|unauthorized|api key|invalid_session|登录会话|请先登录/.test(normalized)) {
    error = {
      category: "authentication",
      code: input.code ?? "AUTHENTICATION_REQUIRED",
      recoveryActions: recoveryFromText(input.recovery) ?? failureDefaults.model_authentication_failed.recoveryActions,
      retryable: false,
      userImpact: "当前请求无法使用模型服务，需要先恢复 Liteasy 登录状态。"
    };
  } else if (/429|rate limit|请求较多/.test(normalized)) {
    error = {
      category: "model",
      code: input.code ?? "MODEL_RATE_LIMITED",
      recoveryActions: recoveryFromText(input.recovery) ?? failureDefaults.model_rate_limited.recoveryActions,
      retryable: true,
      userImpact: "模型服务当前请求较多，本次操作尚未完成。"
    };
  } else if (/selection|选中文献|文本索引|pdf|import/.test(normalized)) {
    error = {
      category: "context",
      code: input.code ?? "TASK_CONTEXT_INCOMPLETE",
      recoveryActions: recoveryFromText(input.recovery) ?? failureDefaults.document_processing_failed.recoveryActions,
      retryable: false,
      userImpact: "当前文献上下文不完整，任务尚不能继续。"
    };
  } else if (/verification|质量门|审计未通过|证据复核|结构校验/.test(normalized)) {
    error = {
      category: "validation",
      code: input.code ?? "OUTPUT_VALIDATION_FAILED",
      recoveryActions: recoveryFromText(input.recovery) ?? failureDefaults.artifact_verification_failed.recoveryActions,
      retryable: false,
      userImpact: "生成结果未通过结构、证据或安全校验，因此没有交付该结果。"
    };
  } else if (/failed to fetch|econnrefused|408|500|502|503|504|连接失败|服务不可用/.test(normalized)) {
    error = {
      category: "network",
      code: input.code ?? "SERVICE_UNAVAILABLE",
      recoveryActions: recoveryFromText(input.recovery) ?? failureDefaults.service_unavailable.recoveryActions,
      retryable: true,
      userImpact: "暂时无法回复，请稍后重试。"
    };
  } else {
    error = {
      category: "internal",
      code: input.code ?? "RUNTIME_EXECUTION_FAILED",
      recoveryActions: recoveryFromText(input.recovery) ?? failureDefaults.artifact_generation_failed.recoveryActions,
      retryable: Boolean(input.recovery),
      userImpact: "运行时未能完成本次操作。"
    };
  }

  return {
    error: {
      ...error,
      category: input.category ?? error.category,
      retryable: input.retryable ?? error.retryable,
      userImpact: input.userImpact ?? error.userImpact,
      ...(diagnosticsRef ? { diagnosticsRef } : {})
    },
    ok: false
  };
}

export function createArtifactTaskError(task: ArtifactTask): AgentRuntimeError | undefined {
  if (!task.failure) {
    return undefined;
  }
  const presentation = presentArtifactFailure(task.failure);
  const defaults = failureDefaults[presentation.code];
  return {
    category: defaults.category,
    code: presentation.code.toUpperCase(),
    ...(presentation.traceId ? { diagnosticsRef: presentation.traceId } : {}),
    recoveryActions: task.failure.recovery.length > 0
      ? task.failure.recovery.map((label, index) => ({
          actionId: `artifact_recovery_${index + 1}`,
          label,
          requiresConfirmation: false
        }))
      : defaults.recoveryActions,
    retryable: defaults.retryable,
    userImpact: presentation.message
  };
}

export function formatAgentRuntimeError(error: AgentRuntimeError) {
  return error.userImpact;
}

export function projectArtifactTaskActivity(task: ArtifactTask): AgentActivityTask {
  const progress = Number.isFinite(task.progress)
    ? Math.max(0, Math.min(100, task.progress))
    : 0;
  const error = createArtifactTaskError(task);
  const safeSummary = error?.userImpact ?? task.message
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[已隐藏的密钥]")
    .replace(/https?:\/\/\S+/g, "[服务地址已隐藏]")
    .slice(0, 500);
  return {
    ...(task.artifactId ? { artifactId: task.artifactId } : {}),
    artifactType: task.type,
    currentStage: task.stage,
    currentStageLabel: artifactStageLabels[task.stage],
    ...(error ? { error } : {}),
    kind: "artifact",
    label: `${artifactTypeLabels[task.type]}任务`,
    progress,
    status: task.status,
    summary: safeSummary,
    taskId: task.id
  };
}

export function createAgentActivityJournal(
  tasks: readonly ArtifactTask[],
  options?: {
    generatedAt?: string;
    scope?: "active" | "failed" | "recent";
  }
): AgentActivityJournal {
  const scope = options?.scope ?? "recent";
  const projected = tasks.map(projectArtifactTaskActivity);
  const scopedTasks = projected.filter((task) => {
    if (scope === "active") return task.status === "queued" || task.status === "running";
    if (scope === "failed") return task.status === "failed";
    return true;
  }).slice(0, 20);
  const activeTaskCount = projected.filter(
    (task) => task.status === "queued" || task.status === "running"
  ).length;
  const failedTaskCount = projected.filter((task) => task.status === "failed").length;
  const summary = activeTaskCount > 0
    ? `当前有 ${activeTaskCount} 个后台任务正在排队或运行${failedTaskCount > 0 ? `，另有 ${failedTaskCount} 个任务失败` : ""}。`
    : failedTaskCount > 0
      ? `当前没有运行中的后台任务；最近有 ${failedTaskCount} 个任务失败。`
      : "当前没有运行中或失败的后台任务。";

  return {
    activeTaskCount,
    failedTaskCount,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    summary,
    tasks: scopedTasks
  };
}

export function createAgentActivityToolCatalog(): AgentActivityToolDefinition[] {
  return [
    {
      description: "列出 Liteasy 真实后台活动。返回任务状态、当前阶段、进度和安全的结构化错误；不会猜测未记录的工作。",
      name: "liteasy_runtime_list_activity",
      parameters: {
        additionalProperties: false,
        properties: {
          scope: { enum: ["active", "failed", "recent"], type: "string" }
        },
        required: ["scope"],
        type: "object"
      },
      strict: true
    },
    {
      description: "按 taskId 查询 Liteasy 后台任务的真实阶段、进度、结果状态和恢复建议。",
      name: "liteasy_runtime_get_task_status",
      parameters: {
        additionalProperties: false,
        properties: {
          taskId: { type: "string" }
        },
        required: ["taskId"],
        type: "object"
      },
      strict: true
    }
  ];
}

function validateToolCallId(value: unknown) {
  const toolCallId = typeof value === "string" ? value.trim() : "";
  if (!toolCallId) {
    throw new Error("Activity toolCallId must be non-empty");
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
    throw new Error(`Unexpected activity tool arguments: ${unexpectedKeys.join(", ")}`);
  }
}

export function executeAgentActivityTool(
  invocation: AgentActivityToolInvocation,
  tasks: readonly ArtifactTask[],
  options?: { generatedAt?: string }
): AgentActivityToolResult {
  const toolCallId = validateToolCallId(invocation.toolCallId);
  if (invocation.toolName === "liteasy_runtime_list_activity") {
    validateArgumentKeys(invocation.arguments, ["scope"]);
    const scope = invocation.arguments.scope;
    if (scope !== "active" && scope !== "failed" && scope !== "recent") {
      throw new Error(`Unsupported activity scope: ${String(scope)}`);
    }
    return {
      journal: createAgentActivityJournal(tasks, {
        generatedAt: options?.generatedAt,
        scope
      }),
      ok: true,
      toolCallId
    };
  }

  if (invocation.toolName !== "liteasy_runtime_get_task_status") {
    throw new Error(`Unknown activity tool: ${String(invocation.toolName)}`);
  }
  validateArgumentKeys(invocation.arguments, ["taskId"]);
  const taskId = typeof invocation.arguments.taskId === "string"
    ? invocation.arguments.taskId.trim()
    : "";
  if (!taskId) {
    throw new Error("Activity taskId must be non-empty");
  }
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return createAgentErrorEnvelope({
      category: "context",
      code: "TASK_NOT_FOUND",
      message: "Requested task was not found",
      recovery: "请刷新后台活动列表后选择仍然存在的任务。",
      retryable: false,
      userImpact: "找不到指定的后台任务；它可能已被清理或属于其他会话。"
    });
  }
  return {
    ok: true,
    task: projectArtifactTaskActivity(task),
    toolCallId
  };
}
