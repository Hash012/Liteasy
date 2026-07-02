import { routeAgentIntent } from "./intentRouter";
import { executeRuntimeSkill } from "./skillExecutor";
import type { AgentRuntimeExecutionContext, AgentRuntimeInput, RuntimeExecutionResult } from "./agentRuntime.types";

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
    const startArtifactAnalysis = context.startArtifactAnalysis;
    if (!startArtifactAnalysis) {
      return {
        events: [
          {
            missing: ["selected_document_set"],
            question: "请先勾选并锁定要分析的文献，再生成思维导图。",
            type: "clarification_request"
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
