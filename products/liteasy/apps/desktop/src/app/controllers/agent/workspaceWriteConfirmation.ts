import { z } from "zod";
import type { HumanConfirmationRequest, RuntimeExecutionResult } from "../../features/agent-runtime/agentRuntime.types";
import type { DesktopAgentEnvironment } from "./createDesktopAgentService";
import type { AgentJsonValue } from "../../features/agent-api/agentApi.types";
import { externalModelAssetService } from "../../features/models/externalSourcePolicy";
import { assetMarkdownLink } from "../../features/markdown/liteasyMarkdownLinks";
import { parseLiteasyPath } from "../../features/resource-filesystem/liteasyPath";
import { studioTools, type StudioToolName } from "../../features/workflow-studio/extensionStudioService";

const proposalSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("asset"), runId: z.string().min(1), scope: z.string().min(1), path: z.string().max(8192), title: z.string().max(8192), expectedRevision: z.string().min(1).max(512), mode: z.enum(["append", "replace"]), text: z.string().max(120000) }),
  z.strictObject({ kind: z.literal("extension"), runId: z.string().min(1), scope: z.string().min(1), tool: z.string().max(128), args: z.record(z.string(), z.json()) })
]);
export type WorkspaceWriteProposal = z.infer<typeof proposalSchema>;
export const WORKSPACE_WRITE_ACTION = "workspace.confirmed_write";

/** A proposal is inert. Only the application's single-use, expiring confirmation registry
 * may execute it; neither user prose nor model/source text can mint an approval. */
export function workspaceWriteConfirmation(proposal: WorkspaceWriteProposal, summary: string): HumanConfirmationRequest {
  const value = proposalSchema.parse(proposal);
  return {
    type: "confirmation_request", confirmationId: crypto.randomUUID(), traceId: value.runId,
    summary, action: { actionId: WORKSPACE_WRITE_ACTION, payload: value },
    plan: { planId: value.runId, intentId: "unknown", actions: [], requiredContext: [], confidence: "high", requiresConfirmation: true, riskLevel: "medium", summary, plannerSource: "rule" }
  };
}

export async function executeWorkspaceWriteConfirmation(input: {
  confirmation: HumanConfirmationRequest; runId: string; signal: AbortSignal;
  reportAssetWrite?: (receipt: AgentJsonValue) => void;
}, environment: DesktopAgentEnvironment): Promise<RuntimeExecutionResult> {
  const proposal = proposalSchema.parse(input.confirmation.action.payload);
  const scope = environment.assetScopeId ?? "local";
  if (input.confirmation.action.actionId !== WORKSPACE_WRITE_ACTION || proposal.runId !== input.runId || input.confirmation.plan.planId !== input.runId || proposal.scope !== scope) throw new Error("写入确认的运行或资料范围已变化，请重新确认。");
  input.signal.throwIfAborted();
  if (!environment.assets) throw new Error("当前资料服务不可用，尚未写入。");
  const assets = externalModelAssetService(environment.assets);
  if (proposal.kind === "asset") {
    parseLiteasyPath(proposal.path, scope);
    const current = await assets.stat(proposal.path, { signal: input.signal });
    if (!current.capabilities.includes("write")) throw new Error("此资产当前只读，尚未写入。");
    if (current.revision !== proposal.expectedRevision) throw new Error("目标在确认前已被修改，请重新读取并确认，现有内容已保留。");
    const receipt = await assets.write(proposal.path, { text: proposal.text, expectedRevision: proposal.expectedRevision, mode: proposal.mode, signal: input.signal });
    // Preserve a committed receipt even if cancellation races with filesystem completion.
    input.reportAssetWrite?.(JSON.parse(JSON.stringify(receipt)) as AgentJsonValue);
    return { settingsChanged: false, events: [{ type: "assistant_reply", message: `已保存 ${assetMarkdownLink(receipt.asset.title, receipt.asset.path)} · +${receipt.addedLines} −${receipt.removedLines} 行。${receipt.warnings?.length ? `\n${receipt.warnings.join("\n")}` : ""}` }] };
  }
  const tool = Object.prototype.hasOwnProperty.call(studioTools, proposal.tool) ? studioTools[proposal.tool as StudioToolName] : undefined;
  if (!tool?.write || !environment.extensionStudio) throw new Error("此制作操作当前不可用，尚未执行。");
  const args = tool.schema.parse(proposal.args);
  const result = await environment.extensionStudio.call(proposal.tool, args, { writable: true, signal: input.signal, externalAssets: assets });
  return { settingsChanged: false, events: [{ type: "assistant_reply", message: `已执行已确认的制作操作。${result && typeof result === "object" && "message" in result && typeof result.message === "string" ? `\n${result.message}` : ""}` }] };
}
