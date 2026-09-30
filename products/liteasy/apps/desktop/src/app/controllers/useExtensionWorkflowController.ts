import { compileExtensionWorkflow } from "../features/extensions/extensionPackage";
import { withModelContextBudget, agentContextLimit } from "../features/context/modelContextBudget";
import { createObjectRepository } from "../features/objects/objectRepository";
import { createBlockRegistry } from "../features/visual-blocks/blockRegistry";
import { createWorkflowTriggers } from "../features/workflows/workflowTriggers";
import { useEffect, useMemo, useRef, useState } from "react";
import { createExtensionWorkspaceStore } from "../features/extensions/extensionWorkspaceStore";
import { createObjectStorage } from "../features/objects/objectStorage";
import type { AgentAssetService } from "../features/resource-filesystem/agentAssetService";
import type { ExtensionPackagesModel } from "../features/extensions/useExtensionPackages";
import type { SettingsState } from "../features/settings/settings.types";
import { createOperationHost, OperationError } from "../features/workflows/operationHost";
import { createWorkflowRunner } from "../features/workflows/workflowRunner";
import { compileWorkflow, type WorkflowDefinition } from "../features/workflows/workflowDefinition";
import { schemaDefaults, type JsonObject, type JsonValue } from "../features/extensions/extensionSchema";
import { createModelGatewayFromSettings } from "../features/models/modelRuntime";
import { getActiveModelProvider, getModelForSettings } from "../features/models/modelPolicy";
import type { ModelTransport } from "../features/models/modelHttpClient";

import type { PendingWorkflow, ExtensionWorkflowModel } from "../features/workflows/extensionWorkflowModel";
export function useExtensionWorkflowController(input: { scope: string; assets: AgentAssetService; packages: ExtensionPackagesModel; settings: SettingsState; open(path: string): Promise<void>; showRuns(): void; modelTransport?: ModelTransport }): ExtensionWorkflowModel {
  const latest = useRef(input); latest.current = input;
  const [pending, setPending] = useState<PendingWorkflow>();
  const [error, setError] = useState("");
  const connection = () => `${getActiveModelProvider(latest.current.settings)}/${getModelForSettings(latest.current.settings)}`;
  const runner = useMemo(() => {
    const storage = createObjectStorage(input.scope, () => latest.current.scope);
    return createWorkflowRunner(storage, createOperationHost({ storage, assets: input.assets, scope: input.scope, repository: createObjectRepository(storage, input.scope), registry: (owner) => createBlockRegistry(latest.current.packages.snapshot.packages.find((pkg) => pkg.manifest.id === owner)?.blocks ?? []),
      enabled: (owner, digest) => latest.current.packages.snapshot.packages.some((pkg) => pkg.manifest.id === owner && pkg.digest === digest),
      open: (path) => latest.current.open(path),
      async model(options) {
        if (options.connection !== connection()) throw new OperationError("permission_denied", "所用模型连接已变化，请重新绑定后开始新运行。");
        const settings = latest.current.settings;
        const model = getModelForSettings(settings), provider = getActiveModelProvider(settings);
        const result = await withModelContextBudget(createModelGatewayFromSettings(settings, { cloudTransport: latest.current.modelTransport }), agentContextLimit(settings["assistant.context_window"])).generateAnswer({
          model, provider, prompt: `${options.prompt}\n\n输出上限约 ${options.maxOutputTokens} tokens。`, signal: options.signal, requireLive: true,
          outputFormat: options.schema ? { name: "workflow_result", strict: true, schema: options.schema as Record<string, unknown> } : undefined,
        });
        const value: JsonValue = options.schema ? JSON.parse(result.answer.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")) : result.answer;
        const tokens = Math.ceil((options.prompt.length + result.answer.length) / 2);
        if (Math.ceil(result.answer.length / 2) > options.maxOutputTokens) throw new OperationError("budget_exceeded", "模型输出超过本节点预算，内容未自动写入。");
        return { value, usage: { tokens, estimated: true }, model, provider };
      },
    }), input.scope);
  }, [input.scope, input.assets]);
  useEffect(() => { setPending(undefined); setError(""); return () => { void runner.list().then((runs) => Promise.all(runs.filter((run) => run.status === "running").map((run) => runner.stop(run.id, "paused")))).catch(() => undefined); }; }, [runner]);
  const triggers = useMemo(() => createWorkflowTriggers(createObjectStorage(input.scope, () => latest.current.scope), runner, input.assets, () => latest.current.scope === input.scope && latest.current.packages.snapshot.packages.length > 0), [runner, input.scope, input.assets]);
  useEffect(() => { let active = true; const tick = () => { if (active) void triggers.tick().catch((e) => setError(String(e))); }; tick(); const timer = setInterval(tick, 30000); return () => { active = false; clearInterval(timer); }; }, [triggers]);
  useEffect(() => { void runner.list().then((runs) => Promise.all(runs.filter((run) => run.status === "running" && !input.packages.snapshot.packages.some((pkg) => pkg.manifest.id === run.owner && pkg.digest === run.digest)).map((run) => runner.stop(run.id, "paused")))).catch(() => undefined); }, [runner, input.packages.snapshot]);
  async function request(owner: string, workflowId: string, selection: string[] = []) {
    const pkg = latest.current.packages.snapshot.packages.find((pkg) => pkg.manifest.id === owner);
    const file = pkg?.manifest.contributes.workflows.find((item) => item.id === workflowId);
    if (!pkg || !file) throw new Error("工作流所属扩展未启用。");
    const plan = compileExtensionWorkflow(pkg, file.path);
    if (plan.capabilities.some((capability) => !pkg.manifest.permissions.some((entry) => entry.capability === capability))) throw new Error("工作流所需能力未完整声明。");
    const args = schemaDefaults(plan.inputSchema) as JsonObject;
    if (plan.inputSchema.properties?.selection) args.selection = selection;
    setPending({ owner, digest: pkg.digest, definition: plan.definition, selection, input: args, capabilities: plan.capabilities }); setError("");
  }
  async function start(parameters: JsonObject, selection: string[]) {
    if (!pending) return;
    const scope = latest.current.scope;
    const pkg = latest.current.packages.snapshot.packages.find((pkg) => pkg.manifest.id === pending.owner && pkg.digest === pending.digest);
    if (!pkg) throw new Error("扩展已变化。");
    const configuration = createExtensionWorkspaceStore(createObjectStorage(scope, () => latest.current.scope));
    const snapshots: JsonObject = {};
    for (const group of pkg.manifest.contributes.settings) { const saved = await configuration.readConfiguration(pkg.manifest.id, group.id, pkg.settings[group.id]); snapshots[group.id] = { values: saved.effective, revision: saved.revision }; }
    const grant = await runner.host.grants.issue({ owner: pending.owner, digest: pending.digest, capabilities: pending.capabilities, selection, output: pending.capabilities.includes("resources.create"), outputKinds: pkg.manifest.permissions.filter((permission) => permission.capability === "resources.create").flatMap((permission) => permission.kinds ?? ["content.note", "workspace.board"]), modelConnection: pending.capabilities.includes("model.invoke") ? connection() : null });
    if (scope !== latest.current.scope) throw new Error("账号已切换。");
    const run = await runner.create({ owner: pending.owner, digest: pending.digest, definition: pending.definition, input: parameters, settings: snapshots, grantId: grant.id });
    setPending(undefined); latest.current.showRuns();
    void runner.execute(run.id).catch((error) => setError(String(error)));
    return run;
  }
  return { runner, triggers, pending, error, request, start, connection: connection(), close: () => setPending(undefined), assets: input.assets };
}

