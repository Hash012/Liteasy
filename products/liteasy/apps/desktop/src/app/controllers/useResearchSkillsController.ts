import { liteasyPath } from "../features/resource-filesystem/liteasyPath";
import { useEffect, useMemo, useRef } from "react";
import type { createArtifactStore } from "../features/artifacts/artifact.store";
import type { ArtifactResultClient } from "../features/artifacts/artifactResultClient";
import type { ArtifactTask } from "../features/artifacts/artifact.types";
import { isArtifactResult } from "../features/artifacts/artifactResultClient";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { createPaperProjectRepository } from "../features/paper-projects/paperProjectRepository";
import type { SettingsState } from "../features/settings/settings.types";
import type { ModelTransport } from "../features/models/modelHttpClient";
import { getActiveModelProvider, getActiveModelEndpoint, getModelForSettings } from "../features/models/modelPolicy";
import { createModelGatewayFromSettings } from "../features/models/modelRuntime";
import { getDirectModelConfig, isDirectModelMode } from "../features/models/modelProviders";
import { getAccountSessionGeneration } from "../features/account/accountSessionStorage";
import { contextTokens } from "../features/context/contextSelection";
import { hashText, resolveContextSnapshot } from "../features/context/objectContext";
import { putDurableEntry, loadDurableEntries } from "../features/persistence/durableJsonStore";
import { executeWorkflowSkill } from "../features/skills/workflowSkillRegistry";
import { loadResearchSkill } from "../features/research-skills/researchSkillCatalog";
import { researchDocumentMarkdown, researchSkillInvocationSchema, type ResearchDestination } from "../features/research-skills/researchDocument";
import { generateResearchDocument } from "../features/research-skills/researchDocumentGeneration";
import { commitResearchDocument, researchArtifact, researchArtifactTab } from "../features/research-skills/researchDocumentCommit";
import type { ResearchSkillsPort } from "../features/research-skills/researchSkillsPort";
import { redactDiagnostic } from "../features/context/objectContext";
import { presentArtifactFailure, resolveArtifactFailureCode } from "../features/artifacts/artifactFailurePresentation";

export function useResearchSkillsController(input: {
  repository: ObjectRepository; projects: ReturnType<typeof createPaperProjectRepository>; destinations: ResearchDestination[];
  settings: SettingsState; modelTransport?: ModelTransport; store: ReturnType<typeof createArtifactStore>;
  client: ArtifactResultClient; sync(): void; notice(message: string): void;
}): ResearchSkillsPort {
  const latest = useRef(input); latest.current = input;
  const scope = input.repository.scopeId;
  const operations = useMemo(() => new Map<string, AbortController>(), [scope]);
  const key = `research:${scope}`;
  async function checkpoint() {
    await putDurableEntry("artifact-tasks", key, input.store.getTasks().filter(task => task.type === "research_document" && task.status !== "completed"));
    input.sync();
  }
  async function publish(taskId: string, generation: string) {
    const task = input.store.getTask(taskId);
    const document = task?.pendingResult?.document;
    if (!document?.researchDocument || document.researchDocument.invocation.scopeId !== scope) throw new Error("待保存文档不属于当前工作区");
    const assertSession = () => {
      if (latest.current.repository.scopeId !== scope || String(getAccountSessionGeneration()) !== generation) throw new Error("账号已变化，请在原账号恢复保存");
    };
    const owner = document.researchDocument.invocation.destination;
    input.store.updateTask(taskId, { status: "running", stage: "saving_result", message: "正在保存科研文档" }); input.sync();
    const receipt = await commitResearchDocument({ document, client: input.client, assertSession,
      assertOwner: async () => {
        if (!latest.current.destinations.some(destination => destination.canonicalEntryId === owner.canonicalEntryId && destination.paperId === owner.paperId)) throw new Error("保存目标已移除，请恢复原论文条目后重试保存");
        const project = (await input.projects.listProjects()).find(project => project.projectId === owner.canonicalEntryId);
        if (!project || project.paperId !== owner.paperId || project.scopeId !== scope) throw new Error("保存目标不再可用");
      },
      project: async saved => {
        await input.projects.addAsset(owner.canonicalEntryId, { assetId: `artifact:${saved.artifactId}`, title: saved.title, kind: "artifact", role: "derived", artifactId: saved.artifactId });
      }
    });
    assertSession();
    input.store.updateTask(taskId, { status: "running" });
    input.store.completeTask(taskId, researchArtifactTab(document, receipt.path));
    input.sync();
    await checkpoint().catch(error => input.notice(`文档已保存，任务状态稍后同步：${String(error)}`));
    if (receipt.projectionPending) input.notice("科研文档已保存，论文列表关联暂未更新；刷新后会重试关联。");
  }
  useEffect(() => {
    let active = true;
    for (const task of input.store.getTasks()) if (task.type === "research_document" && task.researchInvocation?.scopeId !== scope) input.store.removeTask(task.id);
    for (const entry of input.store.getCatalog()) if (entry.researchDocument && entry.researchDocument.invocation.scopeId !== scope) input.store.removeCatalogEntry(entry.artifactId);
    input.sync();
    void loadDurableEntries("artifact-tasks").then(entries => {
      if (!active) return;
      for (const raw of (Array.isArray(entries[key]) ? entries[key] : []) as ArtifactTask[]) {
        if (raw?.type !== "research_document" || typeof raw.id !== "string") continue;
        if (raw.pendingResult && (!isArtifactResult(raw.pendingResult.document) || raw.pendingResult.document.researchDocument?.invocation.scopeId !== scope)) continue;
        input.store.restoreInterruptedTask(raw);
      }
      input.sync();
      // The authoritative artifact wins over an interrupted task checkpoint.
      void input.client.list().then(saved => {
        if (!active) return;
        for (const document of saved) if (document.researchDocument?.invocation.scopeId === scope) input.store.upsertCatalogEntry(researchArtifactTab(document));
        for (const task of input.store.getTasks()) {
          const document = saved.find(item => item.artifactId === task.pendingResult?.document.artifactId && item.researchDocument?.invocation.scopeId === scope);
          if (document) { input.store.updateTask(task.id, { status: "running" }); input.store.completeTask(task.id, researchArtifactTab(document)); }
        }
        input.sync();
      }).catch(error => input.notice(`科研文档状态暂未同步：${String(error)}`));
    }).catch(error => input.notice(`科研任务恢复失败：${String(error)}`));
    return () => { active = false; for (const controller of operations.values()) controller.abort(); };
  }, [scope]);
  return {
    async createEditableCopy(document) {
      if (document.invocation.scopeId !== scope || latest.current.repository.scopeId !== scope) throw new Error("文档不属于当前账号");
      const owner = document.invocation.destination;
      if (!latest.current.destinations.some(destination => destination.canonicalEntryId === owner.canonicalEntryId)) throw new Error("原论文条目已移除");
      const refs = document.sources.flatMap(source => "objectId" in source.ref ? [source.ref] : []);
      await input.projects.createNote(owner.canonicalEntryId, researchDocumentMarkdown(document), `${document.draft.title} · 编辑副本`, refs, crypto.randomUUID(), document.invocation.requestId);
    },
    destinations: input.destinations,
    async start(request) {
      const selected = structuredClone(request.selection);
      const owner = selected.destination;
      if (!owner || owner.scopeId !== scope) throw new Error("请选择科研文档保存到哪篇论文");
      const skill = await loadResearchSkill(selected.skill);
      const settings = structuredClone(input.settings);
      const provider = getActiveModelProvider(settings), model = getModelForSettings(settings);
      const generation = String(getAccountSessionGeneration());
      const active = () => latest.current.repository.scopeId === scope && String(getAccountSessionGeneration()) === generation;
      const controller = new AbortController();
      const limit = Math.min(200000, Number(settings["assistant.context_window"]) || 32768);
      const overhead = contextTokens(skill.instructions + skill.contract + skill.template + request.prompt) + 8000;
      const snapshot = await resolveContextSnapshot({ repository: input.repository, refs: request.refs, purpose: selected.skill.id, policy: "strict", budget: Math.max(0, limit - overhead), active });
      if (!active()) throw new Error("账号已变化");
      const requestId = crypto.randomUUID();
      const invocation = researchSkillInvocationSchema.parse({ schema: "liteasy.skill-invocation/v1", requestId, scopeId: scope, sessionGeneration: generation, skill: selected.skill,
        prompt: request.prompt, preset: selected.preset, destination: owner, origin: request.origin,
        inputs: skill.adapter.inputs.roles.map(role => ({ role: role.id, refs: request.refs.filter(ref => (selected.roles[JSON.stringify(ref)] ?? skill.adapter.inputs.roles[0].id) === role.id) })).filter(role => role.refs.length),
        modelBindingId: await hashText(JSON.stringify([provider, model, settings["models.connection_mode"], getActiveModelEndpoint(settings)])), contextSnapshotId: snapshot.snapshotId,
        budget: { inputTokens: limit, outputTokens: 4000, repairAttempts: 1 } });
      const taskId = input.store.createTask("research_document");
      input.store.updateTask(taskId, { researchInvocation: invocation, origin: request.origin, agentRunId: requestId, sourcePaperIds: [owner.paperId], message: "正在生成科研文档", stage: "generating_answer", status: "running" });
      await checkpoint();
      operations.set(taskId, controller);
      const gateway = createModelGatewayFromSettings(settings, { cloudTransport: input.modelTransport });
      const timeout = setTimeout(() => controller.abort(new Error("生成超时，请减少资料或输出篇幅后重试")), 300000);
      void executeWorkflowSkill({ skillId: selected.skill.id, version: selected.skill.version, input: { requestId } }, {
        async runResearchDocument(call) {
          if (call.requestId !== requestId || call.skillId !== selected.skill.id || call.skillVersion !== selected.skill.version || !active()) throw new Error("方法调用绑定无效");
          const document = await generateResearchDocument({ skill, invocation, snapshot, provider, model, signal: controller.signal, generate: gateway.generateAnswer,
            onProgress(stage) {
              if (!active() || controller.signal.aborted) return;
              const message = stage === "validating" ? "正在检查文档结构与来源引用" : stage === "repairing" ? "正在修复文档格式与引用" : "正在生成科研文档";
              if (input.store.getTask(taskId)?.message === message) return;
              input.store.updateTask(taskId, { stage: stage === "validating" ? "structuring_artifact" : "generating_answer", message });
              input.sync();
            } });
          controller.signal.throwIfAborted();
          if (!active()) throw new Error("账号已变化，未发布到当前账号");
          const artifactId = `research-${await hashText(`${scope}\0${requestId}\0document`)}`;
          const result = researchArtifact(document, artifactId, new Date().toISOString());
          input.store.updateTask(taskId, { pendingResult: { scopeId: scope, document: result, tab: researchArtifactTab(result) } });
          await checkpoint(); // Durable validated bytes precede the authoritative write.
          controller.signal.throwIfAborted();
          await publish(taskId, generation);
          return { artifactId, resourceUri: liteasyPath(scope, { kind: "artifact", artifactId }), message: "科研文档已保存" };
        }
      }).catch(async error => {
        if (!active() || input.store.getTask(taskId)?.status === "cancelled") return;
        const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
        const message = redactDiagnostic(reason instanceof Error ? reason.message : String(reason));
        const failedStage = input.store.getTask(taskId)?.stage ?? "generating_answer";
        const config = isDirectModelMode(settings) ? getDirectModelConfig(settings) : undefined;
        const failure: NonNullable<ArtifactTask["failure"]> = { failedStage, message, code: resolveArtifactFailureCode(message, failedStage), provider, model, endpoint: redactDiagnostic(getActiveModelEndpoint(settings)),
          request: { connection: config ? "direct" : "cloud", protocol: config?.protocol, outputFormat: config?.outputFormat, maxOutputTokens: invocation.budget.outputTokens, sourceCount: snapshot.entries.length },
          occurredAt: new Date().toISOString(), recovery: input.store.getTask(taskId)?.pendingResult ? ["重试保存已有结果"] : ["查看诊断日志或让 AI 分析错误"] };
        input.store.failTask(taskId, failure);
        input.notice(presentArtifactFailure(failure).message);
        await checkpoint().catch(failure => input.notice(`任务检查点保存失败：${String(failure)}`));
      }).finally(() => { clearTimeout(timeout); operations.delete(taskId); });
      return { taskIds: [taskId], message: `正在使用“${skill.adapter.display.title}”，结果将保存到“${owner.title}”` };
    },
    async retry(taskId) {
      if (operations.has(taskId)) return;
      const lock = new AbortController(); operations.set(taskId, lock);
      try { await publish(taskId, String(getAccountSessionGeneration())); }
      catch (error) { input.store.failTask(taskId, { failedStage: "saving_result", message: String(error), occurredAt: new Date().toISOString(), recovery: ["重试保存已有结果"] }); await checkpoint(); throw error; }
      finally { operations.delete(taskId); }
    },
    async cancel(taskId) {
      if (input.store.getTask(taskId)?.stage === "saving_result") return "正在确认保存结果，请稍候";
      operations.get(taskId)?.abort(); input.store.cancelTask(taskId); await checkpoint(); return "已停止生成";
    }
  };
}
