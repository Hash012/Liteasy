import { evaluatePureOperation } from "./pureOperations";
import type { ObjectStorage } from "../objects/objectStorage";
import { hashText } from "../context/objectContext";
import { boundedJson, validateSchemaValue, type JsonObject, type JsonValue } from "../extensions/extensionSchema";
import { compileWorkflow, resolveBinding, validateWorkflowInput, type WorkflowDefinition } from "./workflowDefinition";
import { operationCatalog } from "./operationCatalog";
import { OperationError, type OperationHost, type OperationReceipt } from "./operationHost";

export type NodeState = { status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled"; attempts: number; operations: string[]; outputKey?: string; error?: string; startedAt?: string; finishedAt?: string };
export type WorkflowRun = {
  schema: "liteasy.workflow-run/v2"; id: string; owner: string; digest: string; definition: WorkflowDefinition; workflowDigest: string; grantId: string;
  input: JsonObject; settings: JsonObject; status: "queued" | "running" | "waiting_input" | "paused" | "succeeded" | "failed" | "cancelled" | "partial";
  nodes: Record<string, NodeState>; outputKey?: string; error?: string; createdAt: string; updatedAt: string; elapsedMs: number;
  operations: number; modelCalls: number; tokens: number; estimatedTokens: boolean; snapshotsCleared?: boolean; revision: string; leaseUntil?: number;
  parentRunId?: string;
};
const activeRuns = new Map<string, { controller: AbortController; stop?: "paused" | "cancelled"; promise: Promise<WorkflowRun> }>();
export function createWorkflowRunner(storage: ObjectStorage, host: OperationHost, scope: string) {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const key = (id: string) => `workflow-run/${id}`;
  async function save(run: WorkflowRun) {
    const revision = crypto.randomUUID();
    const value = { ...run, revision, updatedAt: new Date().toISOString() };
    boundedJson(value);
    await storage.commit([{ key: key(run.id), expected: run.revision || null, row: { key: key(run.id), version: revision, value } }]);
    Object.assign(run, value); notify();
  }
  async function get(id: string): Promise<WorkflowRun> {
    const row = await storage.get(key(id));
    if (!row) throw new OperationError("not_found", "运行记录不存在。");
    const value = row.value as WorkflowRun;
    if (value.schema !== "liteasy.workflow-run/v2") throw new OperationError("unsupported_version", "此运行记录来自其他版本，原始内容已保留。");
    compileWorkflow(value.definition);
    if (await hashText(JSON.stringify(value.definition)) !== value.workflowDigest) throw new OperationError("invalid_input", "工作流版本摘要不符，不能恢复执行。");
    return { ...value, revision: row.version };
  }
  async function snapshot(id: string, node: string, value: JsonValue) {
    boundedJson(value); const outputKey = `workflow-snapshot/${id}/${node}`, previous = await storage.get(outputKey);
    await storage.commit([{ key: outputKey, expected: previous?.version ?? null, row: { key: outputKey, version: crypto.randomUUID(), value: { schema: "liteasy.run-snapshot/v1", digest: await hashText(JSON.stringify(value)), value } } }]);
    return outputKey;
  }
  async function loadSnapshot(outputKey: string): Promise<JsonValue> {
    const row = await storage.get(outputKey), saved = row?.value as { schema?: string; value: JsonValue; digest?: string } | undefined;
    if (!saved || saved.schema !== "liteasy.run-snapshot/v1" || await hashText(JSON.stringify(saved.value)) !== saved.digest) throw new OperationError("not_found", "运行快照缺失或摘要不符，无法完整回放。");
    return saved.value;
  }
  async function execute(id: string, options: { singleStep?: boolean; response?: JsonValue } = {}) {
    const activeKey = `${scope}/${id}`;
    if (activeRuns.has(activeKey)) return activeRuns.get(activeKey)!.promise;
    const controller = new AbortController();
    const task = { controller, stop: undefined as "paused" | "cancelled" | undefined, promise: null as unknown as Promise<WorkflowRun> };
    const work = async () => {
      const run = await get(id);
      if (run.status === "succeeded" || run.status === "cancelled") return run;
      if (run.status === "running" && (run.leaseUntil ?? 0) > Date.now()) throw new OperationError("conflict", "运行仍持有执行租约，请稍后恢复。");
      if (run.snapshotsCleared) throw new OperationError("not_found", "正文快照已清理，请创建新运行。");
      const plan = compileWorkflow(run.definition);
      const outputs: Record<string, JsonValue> = {};
      for (const [nodeId, state] of Object.entries(run.nodes)) if (state.status === "succeeded" && state.outputKey) outputs[nodeId] = await loadSnapshot(state.outputKey);
      const started = Date.now(), previousElapsed = run.elapsedMs;
      const deadline = setTimeout(() => controller.abort(new OperationError("budget_exceeded", "达到运行时间上限。")), Math.max(1, plan.definition.budget.maxMilliseconds - run.elapsedMs));
      // Only this execution mutates the run; checkpoints serialize before each batch and after it.
      run.status = "running"; delete run.error; run.leaseUntil = Date.now() + plan.definition.budget.maxMilliseconds + 5000;
      for (const state of Object.values(run.nodes)) if (["running", "failed", "cancelled"].includes(state.status)) { state.status = "pending"; delete state.error; }
      await save(run);
      let completed = 0;
      const outputPaths = new Set<string>();
      const collectPaths = (value: JsonValue) => { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(collectPaths); return; } if (typeof value.path === "string" && value.path.startsWith("liteasy://")) outputPaths.add(value.path); if (value.asset) collectPaths(value.asset); };
      for (const [nodeId, value] of Object.entries(outputs)) if (plan.definition.nodes.find((node) => node.id === nodeId)?.operation.id && ["resources.create", "boards.compose"].includes(plan.definition.nodes.find((node) => node.id === nodeId)!.operation.id)) collectPaths(value);
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const pending = plan.order.filter((nodeId) => run.nodes[nodeId].status === "pending");
          if (!pending.length) break;
          const ready = pending.filter((nodeId) => [...plan.dependencies.get(nodeId)!].every((dependency) => ["succeeded", "skipped"].includes(run.nodes[dependency].status)));
          if (!ready.length) throw new OperationError("invalid_input", "没有可执行节点；前驱失败或状态不完整。");
          const batch: string[] = [];
          for (const nodeId of ready) {
            const node = plan.definition.nodes.find((item) => item.id === nodeId)!;
            const incoming = plan.definition.edges.filter((edge) => edge.to === nodeId);
            const skip = incoming.some((edge) => edge.when !== undefined && outputs[edge.from] !== edge.when) ||
              (incoming.length > 0 && incoming.every((edge) => run.nodes[edge.from].status === "skipped")) ||
              (node.operation.id !== "core.join" && [...plan.dependencies.get(nodeId)!].some((dependency) => run.nodes[dependency].status === "skipped"));
            if (skip) { run.nodes[nodeId].status = "skipped"; continue; }
            if (node.breakpoint && completed > 0) { run.status = "paused"; await save(run); return run; }
            if (node.operation.id === "core.wait" && options.response === undefined) { run.status = "waiting_input"; run.error = String(resolveBinding(node.input.message, { input: run.input, settings: run.settings, outputs })); await save(run); return run; }
            batch.push(nodeId); if (batch.length >= (options.singleStep ? 1 : plan.definition.budget.concurrency)) break;
          }
          await save(run);
          if (!batch.length) continue;
          // Deterministic reservation of budgets and intents happens before parallel calls.
          const jobs = batch.map((nodeId) => {
            const node = plan.definition.nodes.find((item) => item.id === nodeId)!;
            const args = Object.fromEntries(Object.entries(node.input).map(([name, binding]) => [name, resolveBinding(binding, { input: run.input, settings: run.settings, outputs })])) as JsonObject;
            if (node.operation.id === "core.join") args.values = Object.fromEntries([...plan.dependencies.get(nodeId)!].filter((dependency) => run.nodes[dependency].status === "succeeded").map((dependency) => [dependency, outputs[dependency]]));
            const items = node.map ? resolveBinding(node.map.items, { input: run.input, settings: run.settings, outputs }) : [null];
            if (!Array.isArray(items) || items.length > (node.map?.maxItems ?? 1)) throw new OperationError("budget_exceeded", `${nodeId}: map 数量超限。`);
            const state = run.nodes[nodeId];
            // Durable reservations survive process interruption and are charged only once.
            const calls = Math.max(0, items.length - state.operations.length);
            if (run.operations + calls > plan.definition.budget.maxOperations) throw new OperationError("budget_exceeded", "达到操作次数上限。");
            run.operations += calls;
            if (node.operation.id === "model.generate") {
              const reserved = Math.ceil(String(args.prompt).length / 2) + Number(args.maxOutputTokens ?? 4096);
              if (run.modelCalls + calls > plan.definition.budget.maxModelCalls || run.tokens + reserved * calls > plan.definition.budget.maxTokens) throw new OperationError("budget_exceeded", "模型调用或 token 预算不足。");
              run.modelCalls += calls; run.tokens += reserved * calls; run.estimatedTokens = true;
            }
            state.status = "running"; state.startedAt = new Date().toISOString();
            state.operations = items.map((_, index) => `${run.id}:${nodeId}:${index}`);
            return { node, args, items };
          });
          await save(run);
          await Promise.all(jobs.map(async ({ node, args, items }) => {
            const state = run.nodes[node.id]; const results: JsonValue[] = [];
            try {
              if (node.operation.id === "core.wait") { outputs[node.id] = options.response!; options.response = undefined; }
              else {
                // Map limits combine with outer concurrency: a batch never exceeds two host calls.
                for (let index = 0; index < items.length; index++) {
                  const value = node.map ? { ...args, [node.map.itemField]: items[index] } : args;
                  let receipt;
                  for (let attempt = 0; attempt <= node.retries; attempt++) {
                    controller.signal.throwIfAborted(); state.attempts++;
                    receipt = await host.call({ operationId: state.operations[index], operation: node.operation.id, value, grantId: run.grantId, owner: run.owner, digest: run.digest, signal: controller.signal, outputPaths: [...outputPaths] });
                    if (["committed", "no_change", "needs_reconciliation"].includes(receipt.status) || attempt === node.retries) break;
                    if (run.operations >= plan.definition.budget.maxOperations) throw new OperationError("budget_exceeded", "重试预算已用完。");
                    run.operations++;
                    await new Promise<void>((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
                  }
                  if (!receipt || !["committed", "no_change"].includes(receipt.status)) throw new OperationError(receipt?.error?.code ?? "operation_failed", receipt?.error?.message ?? "操作未完成。");
                  results.push(receipt.result ?? null);
                }
                outputs[node.id] = node.map ? results : results[0] ?? null;
              }
              state.outputKey = await snapshot(run.id, node.id, outputs[node.id]); state.status = "succeeded"; state.finishedAt = new Date().toISOString();
              if (["resources.create", "boards.compose"].includes(node.operation.id)) collectPaths(outputs[node.id]);
            } catch (error) { state.status = controller.signal.aborted ? "cancelled" : "failed"; state.error = error instanceof Error ? error.message : String(error); }
          }));
          completed += jobs.length;
          run.elapsedMs = previousElapsed + Date.now() - started;
          await save(run);
          if (jobs.some(({ node }) => run.nodes[node.id].status === "failed")) throw new OperationError("operation_failed", jobs.map(({ node }) => run.nodes[node.id].error).filter(Boolean).join("\n"));
          controller.signal.throwIfAborted();
          if (options.singleStep) { run.status = "paused"; await save(run); return run; }
        }
        const output = resolveBinding(plan.definition.output, { input: run.input, settings: run.settings, outputs });
        validateSchemaValue(plan.outputSchema, output);
        run.outputKey = await snapshot(run.id, "$result", output); run.status = "succeeded";
      } catch (error) {
        let changed = false;
        for (const state of Object.values(run.nodes)) for (const operation of state.operations) { const receipt = await host.receipt(operation); if (receipt && operationCatalog[receipt.operation].effect === "write" && ["committed", "needs_reconciliation"].includes(receipt.status)) changed = true; }
        run.status = task.stop ?? (changed ? "partial" : "failed"); run.error = error instanceof Error ? error.message : String(error);
      } finally { clearTimeout(deadline); delete run.leaseUntil; run.elapsedMs = previousElapsed + Date.now() - started; await save(run); }
      return run;
    };
    task.promise = work().finally(() => { if (activeRuns.get(activeKey) === task) activeRuns.delete(activeKey); }); activeRuns.set(activeKey, task);
    return task.promise;
  }
  return {
    host, get, execute,
    async sourcePaths(id: string) { const run = await get(id); return (await host.grants.get(run.grantId)).selection; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async list() { return (await storage.list("workflow-run/", "", 200)).flatMap((row) => (row.value as WorkflowRun).schema === "liteasy.workflow-run/v2" ? [{ ...row.value as WorkflowRun, revision: row.version }] : []); },
    async create(options: { owner: string; digest: string; definition: WorkflowDefinition; grantId: string; input: JsonObject; settings?: JsonObject; parentRunId?: string; id?: string }) {
      const plan = compileWorkflow(options.definition); validateWorkflowInput(plan, options.input);
      if (options.id) { if (!/^[a-zA-Z0-9-]{1,128}$/.test(options.id)) throw new Error("运行 ID 无效。"); const previous = await storage.get(key(options.id)); if (previous) { const existing = await get(options.id); if (existing.owner !== options.owner || existing.digest !== options.digest || existing.grantId !== options.grantId || JSON.stringify(existing.input) !== JSON.stringify(options.input) || JSON.stringify(existing.settings) !== JSON.stringify(options.settings ?? {}) || existing.workflowDigest !== await hashText(JSON.stringify(plan.definition))) throw new Error("运行标识对应不同的调用。"); return existing; } }
      const run: WorkflowRun = { schema: "liteasy.workflow-run/v2", ...options, id: options.id ?? crypto.randomUUID(), settings: options.settings ?? {}, workflowDigest: await hashText(JSON.stringify(plan.definition)), definition: plan.definition, status: "queued", nodes: Object.fromEntries(plan.order.map((id) => [id, { status: "pending", attempts: 0, operations: [] }])), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), elapsedMs: 0, operations: 0, modelCalls: 0, tokens: 0, estimatedTokens: true, revision: "" };
      await save(run); return run;
    },
    async stop(id: string, status: "paused" | "cancelled") {
      const task = activeRuns.get(`${scope}/${id}`);
      if (task) { task.stop = status; task.controller.abort(new OperationError("cancelled", status === "paused" ? "运行已暂停。" : "运行已取消；已保存的内容保留。")); notify(); return; }
      const run = await get(id); if (run.status === "succeeded") return; run.status = status; await save(run);
    },
    async replay(id: string) {
      const run = await get(id); const nodes: Record<string, JsonValue> = {}; const missing: string[] = [];
      for (const [id, node] of Object.entries(run.nodes)) if (node.outputKey) { try { nodes[id] = await loadSnapshot(node.outputKey); } catch { missing.push(id); } }
      const receipts: Record<string, OperationReceipt> = {};
      for (const node of Object.values(run.nodes)) for (const operation of node.operations) { const receipt = await host.receipt(operation); if (receipt) receipts[operation] = receipt; }
      return { run, nodes, missing, receipts, mode: "recorded" as const };
    },
    async recompute(id: string) {
      const recorded = await this.replay(id);
      if (recorded.run.snapshotsCleared || recorded.missing.length) throw new Error("缺少原始快照，无法按固定条件重算。");
      const { run } = recorded, plan = compileWorkflow(run.definition), outputs: Record<string, JsonValue> = {};
      const checks: Array<{ node: string; mode: "recomputed" | "recorded"; matches: boolean }> = [];
      for (const id of plan.order) {
        if (run.nodes[id].status !== "succeeded") continue;
        const node = plan.definition.nodes.find((item) => item.id === id)!;
        if (operationCatalog[node.operation.id].effect !== "pure" || node.operation.id === "core.wait") {
          outputs[id] = recorded.nodes[id]; checks.push({ node: id, mode: "recorded", matches: true }); continue;
        }
        const args = Object.fromEntries(Object.entries(node.input).map(([key, binding]) => [key, resolveBinding(binding, { input: run.input, settings: run.settings, outputs })])) as JsonObject;
        if (node.operation.id === "core.join") args.values = Object.fromEntries([...plan.dependencies.get(id)!].filter((dependency) => run.nodes[dependency].status === "succeeded").map((dependency) => [dependency, outputs[dependency]]));
        const items = node.map ? resolveBinding(node.map.items, { input: run.input, settings: run.settings, outputs }) : [null];
        if (!Array.isArray(items) || items.length > (node.map?.maxItems ?? 1)) throw new Error("固定输入超出映射限制。");
        const values = items.map((item) => evaluatePureOperation(node.operation.id, node.map ? { ...args, [node.map.itemField]: item } : args));
        outputs[id] = node.map ? values : values[0];
        checks.push({ node: id, mode: "recomputed", matches: await hashText(JSON.stringify(outputs[id])) === await hashText(JSON.stringify(recorded.nodes[id])) });
      }
      return { runId: id, mode: "deterministic" as const, checks };
    },
    async clearSnapshots(id: string) {
      const run = await get(id); if (activeRuns.has(`${scope}/${id}`)) throw new Error("请先停止运行。");
      const rows = await storage.list(`workflow-snapshot/${id}/`, "", 200);
      await storage.commit(rows.map((row) => ({ key: row.key, expected: row.version, row: null })));
      // Operation bodies and undo text also contain snapshots. Keep receipt identity/status only.
      for (const node of Object.values(run.nodes)) for (const operation of node.operations) { const key = `extension-operation/${encodeURIComponent(operation)}`; const row = await storage.get(key); if (row) { const { result: _result, undo: _undo, ...receipt } = row.value as Record<string, unknown>; await storage.commit([{ key, expected: row.version, row: { key, version: crypto.randomUUID(), value: receipt } }]); } }
      run.input = {}; run.settings = {}; run.snapshotsCleared = true; await save(run);
    },
  };
}
export type WorkflowRunner = ReturnType<typeof createWorkflowRunner>;
