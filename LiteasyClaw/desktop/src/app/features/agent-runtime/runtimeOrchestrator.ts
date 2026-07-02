import { routeAgentIntent } from "./intentRouter";
import { executeSemanticPlan } from "./planExecutor";
import { planSemanticCommand } from "./semanticPlanner";
import { executeRuntimeSkill } from "./skillExecutor";
import { getRegisteredActionMetadata } from "../skills/actionRegistry";
import type {
  AgentRuntimeExecutionContext,
  AgentRuntimeInput,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";

function getArtifactClarification(context: AgentRuntimeExecutionContext) {
  const selection = context.contextView?.selection;

  if (!selection || selection.selectedCount === 0) {
    return {
      missing: ["selected_document_set"],
      question: "请先勾选要分析的文献，再生成思维导图。",
      type: "clarification_request" as const
    };
  }

  if (!selection.locked) {
    return {
      missing: ["selected_document_set"],
      question: "请先锁定当前选中文献集，再生成思维导图。",
      type: "clarification_request" as const
    };
  }

  if (selection.importedCount < selection.selectedCount) {
    return {
      missing: ["ingested_documents"],
      question: "请先导入当前选中文献集，再生成思维导图。",
      type: "clarification_request" as const
    };
  }

  return null;
}

export async function runAgentRuntime(
  input: AgentRuntimeInput,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const semanticPlanner = context.semanticPlanner ?? planSemanticCommand;
  const semanticPlan =
    input.mode === "command"
      ? await semanticPlanner(input, {
          contextView: context.contextView,
          registeredActions: getRegisteredActionMetadata()
        })
      : null;

  if (semanticPlan && shouldExecuteSemanticPlan(semanticPlan)) {
    return executeSemanticPlan(semanticPlan, context);
  }

  const plan = routeAgentIntent(input);

  if (plan.kind === "unknown") {
    if (semanticPlan) {
      return executeSemanticPlan(semanticPlan, context);
    }

    return {
      events: [
        {
          message: plan.message,
          type: "runtime_error"
        }
      ],
      settingsChanged: false
    };
  }

  if (plan.kind === "artifact") {
    const clarification = getArtifactClarification(context);
    if (clarification) {
      return {
        events: [clarification],
        settingsChanged: false
      };
    }

    const startArtifactAnalysis = context.startArtifactAnalysis;
    if (!startArtifactAnalysis) {
      return {
        events: [
          {
            message: "思维导图产物执行能力尚未注册。",
            recovery: "请检查 artifact action 是否已连接。",
            type: "runtime_error"
          }
        ],
        settingsChanged: false
      };
    }

    return {
      events: [
        {
          artifact: {
            artifactType: plan.artifact.artifactType,
            payload: plan.artifact.payload
          },
          type: "artifact_request"
        },
        {
          message: startArtifactAnalysis(plan.artifact.artifactType),
          type: "assistant_reply"
        }
      ],
      settingsChanged: false
    };
  }

  return executeRuntimeSkill(plan, context);
}

function shouldExecuteSemanticPlan(plan: SemanticActionPlan) {
  return (
    plan.actions.length > 0 ||
    plan.intentId === "artifact.generate" ||
    plan.intentId === "cloud.sync_workspace" ||
    plan.intentId === "cloud.upload_documents" ||
    plan.intentId === "layout.change" ||
    plan.intentId === "theme.apply" ||
    plan.intentId === "panel.change" ||
    plan.intentId === "selected_set.import" ||
    plan.intentId === "settings.update" ||
    plan.intentId === "organization.open_shared_library" ||
    plan.intentId === "workspace.batch_update_documents" ||
    plan.intentId === "workspace.delete_documents" ||
    plan.intentId === "workspace.overwrite_documents" ||
    Boolean(plan.unsupportedReason)
  );
}
