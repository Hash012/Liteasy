import { createCodexAppServerBackend } from "../../features/research-loop/codexAppServerBackend";
import { Channel, invoke } from "@tauri-apps/api/core";
import { researchCapabilities, researchSchemas } from "../../features/research-loop/researchCapabilities";
import { type CodexMessage, type CodexTool } from "../../features/research-loop/codexAppServer";
import { type ResearchHostPort, type ResearchTaskDetail } from "../../features/research-loop/researchHostClient";
import { createContentReadLedger } from "../../features/resource-filesystem/contentReadLedger";
import { evidenceReportFromAssetReads } from "../../features/evidence/evidenceAdapters";
import { externalModelAssetService } from "../../features/models/externalSourcePolicy";
import { liteasyPath } from "../../features/resource-filesystem/liteasyPath";
import type { AgentAssetService } from "../../features/resource-filesystem/agentAssetService";
import type { AgentCommandExecutionInput, AgentKnowledgeExecutionResult } from "./agentApplicationService";

const { research_read_source: readSchema, research_draft_hypothesis: draftSchema, research_prepare_spec: prepareSchema, research_get_run: runSchema } = researchSchemas;
const tools: CodexTool[] = researchCapabilities().map(capability => ({ type: "function", name: capability.actionId, description: capability.label, inputSchema: capability.inputSchema }));
export type ResearchBackendGrant = { grantId: string; accountId: string; model: string; sources: Array<{ objectId: string; revision: string }> };

export async function runCodexResearch(input: AgentCommandExecutionInput, options: {
  scope: string; active(): boolean; host: ResearchHostPort; assets: AgentAssetService; grant: ResearchBackendGrant;
}): Promise<AgentKnowledgeExecutionResult> {
  const taskId = input.request.input.researchTaskId;
  if (!taskId) throw new Error("研究任务未绑定。");
  const check = () => { input.signal.throwIfAborted(); if (!options.active()) throw new Error("账号或研究权限已变化。"); };
  check();
  const detail = await options.host.call<ResearchTaskDetail>("get", { taskId });
  if (detail.task.parentSessionRef && detail.task.parentSessionRef !== input.request.sessionId) throw new Error("研究会话与任务不匹配。");
  const assets = externalModelAssetService(options.assets);
  const refKey = (ref: { objectId: string; revision: string }) => JSON.stringify([ref.objectId, ref.revision]);
  const allowed = new Set(options.grant.sources.map(refKey));
  for (const ref of options.grant.sources) await assets.stat(liteasyPath(options.scope, { kind: "object", ref }));
  const ledger = createContentReadLedger(input.runId, options.scope);
  const handlers = new Set<(value: CodexMessage) => void>();
  const events = new Channel<CodexMessage>(); events.onmessage = value => handlers.forEach(handler => handler(value));
  const worker = await invoke<{ workerId: string }>("codex_backend_start", {
    request: { scope: options.scope, taskId, agentRunId: input.runId, grantId: options.grant.grantId, accountId: options.grant.accountId, model: options.grant.model }, events,
  });
  try { check(); } catch (error) {
    await invoke("codex_backend_stop", { workerId: worker.workerId }).catch(() => undefined);
    throw error;
  }
  const send = (message: CodexMessage) => {
    // Cancellation must be able to send its interrupt after AbortSignal is set.
    if (message.method !== "turn/interrupt") check();
    return invoke<void>("codex_backend_send", { workerId: worker.workerId, message });
  };
  const client = createCodexAppServerBackend({ transport: { send, subscribe(handler) { handlers.add(handler); return () => handlers.delete(handler); } }, tools, callTool:
    async (name, args) => {
      check();
      input.reportManagerActivity({ activityId: input.runId + ":tool:" + name, kind: "tool_call", label: "研究工具", status: "running", detail: name });
      let result: unknown;
      if (name === "research_read_source") {
        const request = readSchema.parse(args);
        if (!allowed.has(refKey(request.reference))) throw new Error("此来源不在本次资料外发授权内。");
        const path = liteasyPath(options.scope, { kind: "object", ref: request.reference });
        const read = await assets.read(path, { offset: request.offset, maxCharacters: 12000, signal: input.signal });
        const readId = await ledger.append(read);
        // Native independently resolves the same fixed source and records admission coverage.
        await options.host.call("record_source_delivery", { taskId, reference: request.reference, offset: read.offset, text: read.text });
        result = { reference: request.reference, text: read.text, offset: read.offset, nextOffset: read.nextOffset,
          totalCharacters: read.totalCharacters, revision: read.asset.revision, evidence: read.evidence };
        await ledger.delivered(input.runId + ":" + readId, JSON.stringify(result), [readId]);
        await input.reportEvidenceCheckpoint?.(evidenceReportFromAssetReads({ id: input.runId, answer: "", scopeId: options.scope, reads: ledger.reads(), readLedger: ledger.snapshot() }));
      } else if (name === "research_draft_hypothesis") {
        const proposal = draftSchema.parse(args);
        if (proposal.literatureRefs.some(ref => !allowed.has(refKey(ref)))) throw new Error("假设引用了未授权来源。");
        result = await options.host.call("draft_hypothesis", { taskId, ...proposal });
      } else if (name === "research_prepare_spec") {
        const proposal = prepareSchema.parse(args);
        result = await options.host.call("prepare_spec", { taskId, ...proposal });
      } else if (name === "research_get_run") {
        const request = runSchema.parse(args);
        if (!detail.runs.some(run => run.runId === request.runId)) throw new Error("运行不属于本研究任务。");
        result = await options.host.call("get_run", request);
      }
      else throw new Error("研究工具未授权。");
      check();
      input.reportManagerActivity({ activityId: input.runId + ":tool:" + name, kind: "tool_result", label: "实际工具回执", status: "completed" });
      if (new TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024) throw new Error("研究工具回执超过本轮资料预算，请使用原始记录入口。");
      return result;
    }, onDelta: input.reportDelta, signal: input.signal });
  try {
    const prior = detail.records.filter(record => record.kind === "backend_checkpoint" && record.body.accountId === options.grant.accountId && record.body.model === options.grant.model
      && JSON.stringify(record.body.sourceRefs) === JSON.stringify(options.grant.sources)).at(-1);
    const result = await client.run({ taskId, model: options.grant.model, signal: input.signal, brief: JSON.stringify({
      goal: input.request.input.message, sources: options.grant.sources,
      knownHypotheses: detail.records.filter(record => record.kind === "hypothesis"
        && (record.body.literatureRefs as Array<{ objectId: string; revision: string }>).every(ref => allowed.has(refKey(ref))))
        .map(record => ({ question: record.body.question, mechanism: record.body.proposedMechanism, predictions: record.body.predictions, status: "speculative" })),
      capability: await options.host.call("capability"),
      unresolved: detail.task.taskBrief.nextCheck,
      rule: "Read actual fixed sources before preparing experiments. Only propose specs; the user approves experiments and claims.",
    }), resumedThread: typeof prior?.body.threadId === "string" ? prior.body.threadId : undefined });
    check();
    return { message: result.message, metadata: { backend: "codex_app_server", loopOwner: result.loopOwner, threadId: result.threadId, toolCalls: result.toolCalls, researchTaskId: taskId, semanticStatus: "unverified" } };
  } finally { client.dispose(); await invoke("codex_backend_stop", { workerId: worker.workerId }).catch(() => undefined); }
}
