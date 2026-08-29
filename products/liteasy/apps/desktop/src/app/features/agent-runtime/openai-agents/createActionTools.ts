import { tool, type FunctionTool, type ToolInputParameters } from "@openai/agents";
import {
  getRuntimeActionPolicy,
  isActionHandlerAvailable,
  type ActionInvocation,
  type RegisteredActionMetadata
} from "../../skills/actionRegistry";
import { invokeAction } from "../invokeAction";
import type { LiteasyRunContext } from "./liteasyRunContext";

export function toLiteasySdkToolName(actionId: string) {
  return actionId.replace(/[^a-zA-Z0-9]/g, "_");
}

export function getActionIdForSdkToolName(
  toolName: string,
  registry: RegisteredActionMetadata[]
) {
  return registry.find((metadata) => toLiteasySdkToolName(metadata.actionId) === toolName)?.actionId;
}

export function createActionTools(
  registry: RegisteredActionMetadata[]
): FunctionTool<LiteasyRunContext, any>[] {
  return registry.map((metadata) => {
    const sdkToolName = toLiteasySdkToolName(metadata.actionId);
    return tool({
      description: metadata.label,
      async execute(input, runContext, details) {
        if (!runContext) {
          throw new Error("Liteasy run context is required");
        }
        const invocation = {
          actionId: metadata.actionId,
          input
        } as ActionInvocation;
        const requiresApproval = getRuntimeActionPolicy(invocation).requiresConfirmation;
        const approved = !requiresApproval || Boolean(
          details?.toolCall &&
          runContext.isToolApproved({
            callId: details.toolCall.callId,
            toolName: sdkToolName
          })
        );
        const result = await invokeAction(metadata.actionId, input, {
          ...runContext.context.actionContext,
          approvedActionIds: approved ? [metadata.actionId] : [],
          invocationId: details?.toolCall
            ? `${runContext.context.runId}:${details.toolCall.callId}`
            : undefined
        });
        runContext.context.actionResults.push({
          input: input as Record<string, unknown>,
          result
        });
        return result;
      },
      isEnabled: ({ runContext }) =>
        isActionHandlerAvailable(metadata.actionId, runContext.context.actionContext),
      name: sdkToolName,
      needsApproval: async (_runContext, input) => {
        const invocation = {
          actionId: metadata.actionId,
          input
        } as ActionInvocation;
        return getRuntimeActionPolicy(invocation).requiresConfirmation;
      },
      parameters: {
        ...metadata.inputSchema,
        additionalProperties: true,
        properties: metadata.inputSchema.properties ?? {},
        required: [...(metadata.inputSchema.required ?? [])],
        type: "object"
      } as Extract<ToolInputParameters, { additionalProperties: true }>,
      strict: false
    });
  });
}
