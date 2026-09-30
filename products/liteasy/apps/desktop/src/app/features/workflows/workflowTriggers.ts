import { OperationError } from "./operationHost";
import type { JsonValue } from "../extensions/extensionSchema";
import { z } from "zod";
import type { ObjectStorage } from "../objects/objectStorage";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import type { WorkflowRunner } from "./workflowRunner";
import { hashText } from "../context/objectContext";
const triggerSchema = z.strictObject({ schema: z.literal("liteasy.workflow-trigger/v1"), id: z.string(), runId: z.string(), enabled: z.boolean(), kind: z.enum(["startup", "resource", "interval"]), minutes: z.number().int().min(1).max(10080), lastTick: z.number(), seen: z.record(z.string(), z.string()), revision: z.string(), startupSession: z.string().optional(), error: z.string().optional() });
export type WorkflowTrigger = z.infer<typeof triggerSchema>;
/** App-open scheduler: no claim of running while closed, and no unbounded catch-up. */
export function createWorkflowTriggers(storage: ObjectStorage, runner: WorkflowRunner, assets: AgentAssetService, enabled: () => boolean) {
  const session = crypto.randomUUID(), inFlight = new Set<string>();
  let ticking = false;
  const get = async (id: string) => { const row = await storage.get(`extension-trigger/${id}`); if (!row) throw new Error("触发配置不存在。"); return triggerSchema.parse(row.value); };
  async function save(value: WorkflowTrigger) { const next = { ...value, revision: crypto.randomUUID() }, key = `extension-trigger/${value.id}`; await storage.commit([{ key, expected: value.revision || null, row: { key, version: next.revision, value: next } }]); return next; }
  async function versions(runId: string) { const run = await runner.get(runId), grant = await runner.host.grants.get(run.grantId); const result: Record<string, string> = {}; for (const path of grant.selection) { const url = new URL(path); url.searchParams.delete("revision"); const asset = await assets.stat(url.toString()); result[path] = asset.revision ?? await hashText(JSON.stringify(asset)); } return result; }
  async function list() { return (await storage.list("extension-trigger/", "", 100)).flatMap((row) => { const value = triggerSchema.safeParse(row.value); return value.success ? [value.data] : []; }); }
  return {
    list,
    async add(runId: string, kind: WorkflowTrigger["kind"], minutes = 60) {
      if ((await list()).length >= 100) throw new Error("自动触发最多保存 100 项，请复用已有配置。");
      const run = await runner.get(runId); if (run.status !== "succeeded") throw new Error("先完成一次手动运行，再设置自动执行。");
      return save(triggerSchema.parse({ schema: "liteasy.workflow-trigger/v1", id: crypto.randomUUID(), runId, enabled: true, kind, minutes, lastTick: Date.now(), seen: await versions(runId), revision: "", startupSession: session }));
    },
    async setEnabled(id: string, enabled: boolean) { return save({ ...await get(id), enabled }); },
    async tick(now = Date.now()) {
      if (!enabled() || ticking) return; ticking = true;
      try {
        for (const trigger of await list()) {
          if (!trigger.enabled || inFlight.has(trigger.id) || !enabled()) continue;
          try {
            const run = await runner.get(trigger.runId), current = await versions(trigger.runId);
            const events = await storage.list(`extension-trigger-event/${trigger.id}/`, "", 1000);
            // Completed intent rows are only dedupe receipts; retain recent history and every queued run.
            const expired = events.filter((row) => (row.value as { status: string; at: number }).status !== "queued" && (row.value as { at: number }).at < now - 7 * 86400000);
            if (expired.length) await storage.commit(expired.map((row) => ({ key: row.key, expected: row.version, row: null })));
            if (events.length - expired.length >= 1000) throw new Error("自动执行记录已达上限，请先检查未完成运行。");
            const queued = events.find((row) => { const value = row.value as { triggerId?: string; status?: string }; return value.triggerId === trigger.id && value.status === "queued"; });
            const changed = Object.keys(current).filter((path) => current[path] !== trigger.seen[path]);
            if (!queued && trigger.kind === "startup" && trigger.startupSession === session) continue;
            const token = trigger.kind === "startup" ? session : trigger.kind === "interval" ? String(Math.floor(now / (trigger.minutes * 60000))) : await hashText(JSON.stringify(current));
            if (!queued && (trigger.kind === "interval" && now - trigger.lastTick < trigger.minutes * 60000 || trigger.kind === "resource" && (!changed.length || now - trigger.lastTick < 60000))) continue;
            const event = queued ? (queued.value as { id: string }).id : await hashText(`${trigger.id}:${run.workflowDigest}:${token}`), key = `extension-trigger-event/${trigger.id}/${event}`;
            if (!queued && await storage.get(key)) continue;
            if (queued) { try { const existing = await runner.get(event); if (existing.status === "running" && (existing.leaseUntil ?? 0) > now) continue; } catch (error) { if (!(error instanceof OperationError) || error.code !== "not_found") throw error; } }
            const freshPaths = Object.fromEntries(Object.entries(current).map(([path, revision]) => { const url = new URL(path); if (url.hostname === "objects") url.searchParams.set("revision", revision); return [path, url.toString()]; }));
            const refresh = (value: JsonValue): JsonValue => typeof value === "string" ? freshPaths[value] ?? value : Array.isArray(value) ? value.map(refresh) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, refresh(item)])) : value;
            const eventInput = queued ? (queued.value as { input: typeof run.input }).input : refresh(run.input) as typeof run.input;
            // Persist a unique event before requesting a deterministically identified run.
            if (!queued) await storage.commit([{ key, expected: null, row: { key, version: event, value: { schema: "liteasy.trigger-event/v1", id: event, triggerId: trigger.id, runId: event, status: "queued", at: now, input: eventInput } } }]);
            const next = await runner.create({ id: event, owner: run.owner, digest: run.digest, definition: run.definition, input: eventInput, settings: run.settings, grantId: run.grantId, parentRunId: run.id });
            inFlight.add(trigger.id);
            await save({ ...trigger, lastTick: now, seen: current, startupSession: session, error: undefined });
            void runner.execute(next.id).then(async (result) => {
              const latest = await get(trigger.id);
              // Only revisions actually written by this run are suppressed. Later user edits remain events.
              const replay = await runner.replay(result.id), produced = new Set(Object.values(replay.receipts).flatMap((receipt) => {
                const value = receipt.result as { asset?: { revision?: string } } | undefined; return receipt.operation === "resources.write" && value?.asset?.revision ? [value.asset.revision] : [];
              }));
              const after = await versions(trigger.runId), seen = { ...latest.seen };
              for (const [path, revision] of Object.entries(after)) if (produced.has(revision)) seen[path] = revision;
              await save({ ...latest, seen, ...(result.status === "succeeded" ? {} : { enabled: false, error: result.error ?? result.status }) });
              const row = await storage.get(key); if (row) await storage.commit([{ key, expected: row.version, row: { ...row, value: { ...row.value as object, status: result.status } } }]);
            }).catch(async (error) => { const latest = await get(trigger.id); await save({ ...latest, enabled: false, error: String(error) }); }).catch(() => { /* Concurrent disable/scope change wins; persisted intent remains recoverable. */ }).finally(() => inFlight.delete(trigger.id));
          } catch (e) { await save({ ...await get(trigger.id), enabled: false, error: String(e) }); }
        }
      } finally { ticking = false; }
    },
  };
}
export type WorkflowTriggers = ReturnType<typeof createWorkflowTriggers>;
