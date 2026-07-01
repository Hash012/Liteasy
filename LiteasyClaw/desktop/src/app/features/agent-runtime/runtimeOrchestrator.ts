import { routeAgentIntent } from "./intentRouter";
import { executeRuntimeSkill } from "./skillExecutor";
import type {
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  AgentRuntimeInput,
  RuntimeExecutionResult
} from "./agentRuntime.types";

function createArtifactContextEvents(context: AgentRuntimeExecutionContext): AgentRuntimeEvent[] | null {
  if (!context.startArtifactAnalysis) {
    return [
      {
        missing: ["selected_document_set"],
        question: "请先勾选并锁定要分析的文献，再生成思维导图。",
        type: "clarification_request"
      }
    ];
  }

  return null;
}

export async function runAgentRuntime(
  input: AgentRuntimeInput,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const plan = routeAgentIntent(input);

  if (plan.kind === "unknown") {
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
    const contextEvents = createArtifactContextEvents(context);
    if (contextEvents) {
      return {
        events: contextEvents,
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
          message: context.startArtifactAnalysis(plan.artifact.artifactType),
          type: "assistant_reply"
        }
      ],
      settingsChanged: false
    };
  }

  return executeRuntimeSkill(plan, context);
}
