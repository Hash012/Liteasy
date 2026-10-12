import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getAccountSessionGeneration } from "../features/account/accountSessionStorage";
import { createChatgptPlanClient, type ChatgptPlanAccounts, type ChatgptPlanModel } from "../features/models/chatgptPlanClient";
import { createResearchHostClient, defaultReplaySpec, hypothesisDraftSchema, researchReportMarkdown,
  type ResearchProjectTask, type ResearchTaskDetail, type ResearchRecord } from "../features/research-loop/researchHostClient";
import { runCodexResearch, type ResearchBackendGrant } from "./agent/runCodexResearch";
import { compileResearchDocument } from "../features/research-loop/researchExportAdapter";
import type { AgentCommandExecutionInput } from "./agent/agentApplicationService";
import type { ObjectRepository } from "../features/objects/objectRepository";
import { refOf, type ObjectRef } from "../features/objects/object.types";
import type { AgentPublicApi } from "../features/agent-api/agentApi.types";
import type { AgentAssetService } from "../features/resource-filesystem/agentAssetService";
import { externalModelAssetService } from "../features/models/externalSourcePolicy";
import { liteasyPath } from "../features/resource-filesystem/liteasyPath";

export function useResearchWorkbenchController(input: { repository: ObjectRepository; assets: AgentAssetService; api: { current: AgentPublicApi | null | undefined } }) {
  const scope = input.repository.scopeId, generation = getAccountSessionGeneration();
  const current = useRef({ scope, generation }); current.current = { scope, generation };
  const active = useCallback(() => current.current.scope === scope && current.current.generation === generation
    && getAccountSessionGeneration() === generation, [scope, generation]);
  const host = useMemo(() => createResearchHostClient(scope, active), [scope, active]);
  const plan = useMemo(() => createChatgptPlanClient(scope, active), [scope, active]);
  const grants = useRef(new Map<string, ResearchBackendGrant>());
  const intents = useRef(new Map<string, { grantId: string; key: string }>());
  const [tasks, setTasks] = useState<ResearchProjectTask[]>([]);
  const [detail, setDetail] = useState<ResearchTaskDetail>();
  const detailRef = useRef(detail); detailRef.current = detail;
  const [connections, setConnections] = useState<ChatgptPlanAccounts>({ activeAccount: null, accounts: [] });
  const [models, setModels] = useState<ChatgptPlanModel[]>([]);
  const [model, setModel] = useState("");
  const [goal, setGoal] = useState("在同样的缓存与 I/O 预算下，预取能否减少等待且保持样本、顺序与跨模态对齐？");
  const [source, setSource] = useState<ObjectRef>();
  const [sources, setSources] = useState<Array<{ ref: ObjectRef; title: string }>>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [answer, setAnswer] = useState("");
  const [backend, setBackend] = useState<{ configured: boolean; requiredVersion: string }>({ configured: false, requiredVersion: "0.154.0" });
  const [candidate, setCandidate] = useState<"sequential" | "last_delta">("sequential");
  const [harnessReceipt, setHarnessReceipt] = useState("");
  const [modelRun, setModelRun] = useState<{ sessionId: string; runId: string }>();
  const [hypothesisId, setHypothesisId] = useState("");
  const [runId, setRunId] = useState("");
  const performing = useRef<symbol | null>(null);
  const refreshRevision = useRef(0);
  const [hypothesis, setHypothesis] = useState({ question: "", proposedMechanism: "", changedAssumption: "",
    prediction: "等待时间减少且样本与顺序完全一致", falsification: "独立工作负载不改善，或样本、顺序、跨模态对齐发生变化" });
  const perform = useCallback(async (work: () => Promise<void>) => {
    if (!active() || performing.current) return;
    const operation = Symbol("research-operation");
    performing.current = operation;
    setBusy(true); setNotice("");
    try { await work(); }
    catch (error) { if (active()) setNotice(error instanceof Error ? error.message : String(error)); }
    finally {
      if (performing.current === operation) { performing.current = null; if (active()) setBusy(false); }
    }
  }, [active]);
  const refresh = useCallback(async (taskId = detailRef.current?.task.taskId) => {
    if (!isTauri()) return;
    const revision = ++refreshRevision.current;
    const items = await host.call<ResearchProjectTask[]>("list");
    if (!active() || revision !== refreshRevision.current) return; setTasks(items);
    if (taskId) {
      const value = await host.call<ResearchTaskDetail>("get", { taskId });
      if (active() && revision === refreshRevision.current) setDetail(value);
    }
  }, [host, active]);
  const refreshConnections = useCallback(async () => {
    const value = await plan.accounts(); if (!active()) return; setConnections(value);
    if (value.activeAccount) {
      const catalog = await plan.models(value.activeAccount); if (!active()) return; setModels(catalog);
      setModel(previous => catalog.some(item => item.slug === previous) ? previous : catalog[0]?.slug ?? "");
    } else { setModels([]); setModel(""); }
  }, [plan, active]);
  useEffect(() => {
    performing.current = null; setBusy(false);
    setConnections({ activeAccount: null, accounts: [] }); setModels([]); setModel(""); setNotice("");
    grants.current.clear(); intents.current.clear(); setTasks([]); setDetail(undefined); setAnswer(""); setModelRun(undefined);
    setHypothesisId(""); setRunId(""); setSources([]); setSource(undefined); setHarnessReceipt("");
    if (!isTauri()) return;
    void refresh().catch(error => { if (active()) setNotice(String(error)); });
    void refreshConnections().catch(() => undefined);
    void invoke<typeof backend>("codex_backend_capability").then(value => { if (active()) setBackend(value); })
      .catch(error => { if (active()) setNotice(String(error)); });
    void input.repository.searchTitles("", 100).then(async rows => {
      const notes = rows.filter(row => row.kind === "content.note" && row.revision).map(row => ({
        ref: { objectId: row.objectId, revision: row.revision! }, title: row.title,
      }));
      if (active()) { setSources(notes); setSource(undefined); }
    }).catch(error => { if (active()) setNotice(String(error)); });
  }, [scope, generation, refresh, refreshConnections]);
  useEffect(() => { setHypothesisId(""); setRunId(""); setAnswer(""); }, [detail?.task.taskId]);
  useEffect(() => {
    if (detail?.task.state !== "running" && !detail?.runs.some(run => ["submitting", "running"].includes(run.status))) return;
    const timer = setInterval(() => { void refresh().catch(error => { if (active()) setNotice(String(error)); }); }, 1000);
    return () => clearInterval(timer);
  }, [detail?.task.taskId, detail?.task.state, detail?.runs, refresh, active]);
  const apiInput = useRef(input); apiInput.current = input;
  const executeResearchTurn = useCallback(async (request: AgentCommandExecutionInput) => {
    const taskId = request.request.input.researchTaskId!;
    const grant = grants.current.get(taskId);
    if (!grant) throw new Error("请先为本研究任务批准所选资料与 ChatGPT 账号的连接。");
    return runCodexResearch(request, { scope, active, host, grant, assets: apiInput.current.assets });
  }, [scope, active, host]);
  const createTask = () => perform(async () => {
    if (!goal.trim()) throw new Error("请填写研究目标。");
    const api = input.api.current; if (!api) throw new Error("研究会话服务尚未就绪。");
    const session = await api.createSession({ consumer: "frontend", metadata: { purpose: "research_task" } });
    if (!session.ok) throw new Error(session.error.message);
    const project = await input.repository.create({ kind: "workspace.board", title: goal.slice(0, 80),
      content: { schema: "liteasy.board/v1", payload: { description: goal } } });
    const task = await host.call<ResearchProjectTask>("create_task", { projectRef: refOf(project), parentSessionRef: session.data.sessionId, goal });
    setHypothesis(previous => ({ ...previous, question: goal, proposedMechanism: "把可观测的样本编号用于预取，尝试与前一个样本的计算重叠。",
      changedAssumption: "下一次访问与最近样本编号之间存在可预测关系；held-out 检查该假设失效时的行为。" }));
    await refresh(task.taskId);
  });
  const createSyntheticSource = () => perform(async () => {
    const object = await input.repository.create({ kind: "content.note", title: "DataLoader 合成实验条件与基线",
      content: { schema: "liteasy.note/v1", payload: { origin: "user", text:
        "# 合成 CPU Trace 实验\n\n这不是论文或新颖性证据。基线是按需读取与 LRU；候选是顺序预取或最近差值预测。\n\n"
        + "统一缓存 32768 字节，样本 4096 字节，单串行 I/O 设备，模拟 I/O 2000 微秒、计算 3000 微秒。已知样本编号；候选不能看到未来请求。\n\n"
        + "训练 trace 按编号顺序访问；held-out 使用不同种子的步进访问。每个样本必须保持 image+label、数量和顺序。\n\n"
        + "先检查正确性，再比较等待时间分位数、读取放大、缓存峰值和回放的真实 CPU 耗时。不能把模拟吞吐换算为真实 GPU 收益。" } } });
    const value = { ref: refOf(object), title: object.title };
    setSources(previous => [...previous, value]); setSource(value.ref);
  });
  const readSource = () => perform(async () => {
    if (!detail || !source) throw new Error("请先选择研究任务与固定来源。");
    const result = await host.call<{ text: string; nextOffset?: number }>("read_source", { taskId: detail.task.taskId, reference: source, offset: 0 });
    setNotice(result.text + (result.nextOffset ? "\n\n此处为有限摘录，不能称为全文。" : ""));
  });
  const saveHypothesis = () => perform(async () => {
    if (!detail) throw new Error("请先创建研究任务。");
    const draft = hypothesisDraftSchema.parse({ question: hypothesis.question, proposedMechanism: hypothesis.proposedMechanism,
      changedAssumption: hypothesis.changedAssumption, nearestBaselines: ["按需读取与 LRU", "顺序预取"],
      applicabilityConditions: ["缓存字节与单设备 I/O 预算相同", "未来请求对候选不可见"], predictions: [hypothesis.prediction],
      falsificationCriteria: [hypothesis.falsification], literatureRefs: source ? [source] : [] });
    const saved = await host.call<ResearchRecord>("draft_hypothesis", { taskId: detail.task.taskId, ...draft });
    setHypothesisId(saved.id); await refresh();
  });
  const prepareSpec = () => perform(async () => {
    if (!detail) throw new Error("请先选择研究任务。");
    const hypotheses = detail.records.filter(record => record.kind === "hypothesis");
    const hypothesis = hypotheses.find(record => record.id === hypothesisId) ?? hypotheses.at(-1);
    if (!hypothesis) throw new Error("请先保存可被证伪的假设。");
    const capability = await host.call<{ validatorVersion: string; codeSnapshot: string }>("capability");
    await host.call("prepare_spec", { taskId: detail.task.taskId, hypothesisId: hypothesis.id, replay: defaultReplaySpec(capability, candidate) }); await refresh();
  });
  const approveAndRun = () => perform(async () => {
    if (!detail) throw new Error("请先选择研究任务。");
    const spec = detail.records.filter(record => record.kind === "spec").at(-1);
    if (!spec) throw new Error("请先准备并检查实验规格。");
    let intention = intents.current.get(spec.id);
    if (!intention) {
      const grant = await host.call<ResearchRecord>("approve_small_experiment", { taskId: detail.task.taskId, specId: spec.id, expectedSpecHash: spec.hash });
      intention = { grantId: grant.id, key: "research-spec-" + spec.id };
      intents.current.set(spec.id, intention);
    }
    const run = await host.call<{ runId: string }>("submit", { taskId: detail.task.taskId, specId: spec.id, grantId: intention.grantId, idempotencyKey: intention.key });
    setRunId(run.runId); await refresh();
  });
  const recordDecision = (action: "narrow" | "stop" | "continue", rationale: string) => perform(async () => {
    if (!detail?.runs.length) throw new Error("请先查看实际运行结果。");
    const selected = detail.runs.find(run => run.runId === runId) ?? detail.runs.at(-1)!;
    await host.call("decision", { taskId: detail.task.taskId, runId: selected.runId, action, rationale }); await refresh();
  });
  const approveModel = () => perform(async () => {
    if (!detail || !connections.activeAccount || !model || !source) throw new Error("请选择任务、资料、已授权 ChatGPT 账号与模型。");
    if (!backend.configured) throw new Error("请先连接所需版本的 Codex 可执行文件。");
    await externalModelAssetService(input.assets).stat(liteasyPath(scope, { kind: "object", ref: source }));
    const grant = await host.call<ResearchRecord>("approve_external_model", { taskId: detail.task.taskId, accountId: connections.activeAccount, model, sourceRefs: [source] });
    grants.current.set(detail.task.taskId, { grantId: grant.id, accountId: connections.activeAccount, model, sources: [source] });
    setNotice("已批准本任务与所选固定资料的连接。");
  });
  const askResearch = () => perform(async () => {
    if (!detail?.task.parentSessionRef || !input.api.current) throw new Error("研究会话不存在，请创建新的研究任务。");
    const grant = grants.current.get(detail.task.taskId);
    if (!grant || grant.accountId !== connections.activeAccount || grant.model !== model
      || !source || JSON.stringify(grant.sources) !== JSON.stringify([source])) {
      throw new Error("账号、模型或资料已变化，请重新批准本次连接。");
    }
    const api = input.api.current, sessionId = detail.task.parentSessionRef; setAnswer("");
    const stop = api.subscribe(sessionId, event => { if (active() && event.type === "assistant.delta") setAnswer(previous => previous + event.delta); });
    try {
      const result = await api.submitTurn({ sessionId, idempotencyKey: crypto.randomUUID(), input: { message: goal, mode: "qa", researchTaskId: detail.task.taskId } });
      if (!result.ok) throw new Error(result.error.message);
      setModelRun({ sessionId, runId: result.data.runId });
      while (active()) {
        const run = await api.getRun({ sessionId, runId: result.data.runId });
        if (!run.ok) throw new Error(run.error.message);
        if (["completed", "failed", "cancelled", "interrupted", "waiting_confirmation"].includes(run.data.status)) {
          if (run.data.status !== "completed") throw new Error("研究推理停止：" + run.data.status);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } finally { stop(); if (active()) { setModelRun(undefined); await refresh(); } }
  });
  const cancelModel = async () => { if (modelRun) await input.api.current?.cancelRun({ ...modelRun, reason: "用户取消研究推理" }); };
  const saveReport = () => perform(async () => {
    if (!detail) throw new Error("请先选择研究任务。");
    const fresh = await host.call<ResearchTaskDetail>("get", { taskId: detail.task.taskId });
    await input.repository.create({ kind: "content.note", title: "研究证据报告：" + detail.task.goal.slice(0, 70),
      content: { schema: "liteasy.note/v1", payload: { origin: "derived", text: researchReportMarkdown(fresh) } },
      sourceRefs: [fresh.task.projectRef], derivedFrom: [fresh.task.projectRef] });
    setNotice("证据报告已保存到笔记，可通过统一文档入口导出。");
  });
  return { supported: isTauri(), tasks, detail, connections, models, model, setModel, goal, setGoal, sources, source, setSource,
    harnessReceipt,
    configureHarness: (python: string, kitRoot: string, workspace: string) => perform(async () => {
      await invoke("research_harness_configure", { scope, config: { python, kitRoot, workspace, fingerprint: null } });
      setNotice("研究校验服务已连接；项目资料仍由原资源系统管理。");
    }),
    checkHarness: (operation: string, recordId: string, packet?: string) => perform(async () => {
      const receipt = await invoke("research_harness_check", { scope, operation, recordId: recordId || null, packet: packet ? JSON.parse(packet) : null, taskId: detail?.task.taskId ?? null });
      setHarnessReceipt(JSON.stringify(receipt, null, 2));
      if (detail) await refresh();
    }),
    compileReport: (options: import("../features/document-export/documentExport.types").ExportOptions, signal: AbortSignal) => {
      if (!detailRef.current) throw new Error("请选择研究任务。");
      return compileResearchDocument({ taskId: detailRef.current.task.taskId, scope, sessionGeneration: generation, active, host, options, signal });
    },
    confirmClaim: () => perform(async () => {
      const claim = detail?.records.filter(record => record.kind === "claim").at(-1);
      if (!claim || !detail) throw new Error("请先查看条件化主张与原始结果。");
      await host.call("confirm_claim", { taskId: detail.task.taskId, claimId: claim.id, expectedClaimHash: claim.hash }); await refresh();
    }),
    busy, notice, answer, backend, candidate, setCandidate, hypothesis, setHypothesis, modelRun,
    hypothesisId, setHypothesisId, runId, setRunId,
    readEvidence: (reference: ObjectRef) => perform(async () => {
      if (!detail) throw new Error("请先选择研究任务。");
      const excerpt = await host.call<{ text: string; nextOffset?: number }>("read_source", { taskId: detail.task.taskId, reference, offset: 0 });
      setNotice(`${reference.objectId} · ${reference.revision}\n\n${excerpt.text}${excerpt.nextOffset ? "\n\n此处仅为部分原文。" : ""}`);
    }),
    createTask, createSyntheticSource, readSource, saveHypothesis, prepareSpec, approveAndRun, recordDecision, approveModel, askResearch, cancelModel,
    saveReport, executeResearchTurn, open: (taskId: string) => perform(() => refresh(taskId)), refresh: () => perform(() => refresh()),
    cancelRun: (runId: string) => perform(async () => { await host.call("cancel", { runId }); await refresh(); }),
    login: () => perform(async () => { await plan.login(); await refreshConnections(); }),
    cancelLogin: plan.cancel,
    selectAccount: (accountId: string) => perform(async () => { await plan.select(accountId); grants.current.clear(); await refreshConnections(); }),
    logout: () => perform(async () => { if (connections.activeAccount) await plan.logout(connections.activeAccount); grants.current.clear(); await refreshConnections(); }),
    verifyModel: () => perform(async () => { if (!connections.activeAccount || !model) throw new Error("请选择账号与模型。");
      await plan.provider(connections.activeAccount).infer({ model, messages: [{ role: "user", content: "Say exactly: Hello, world!" }] }); await refreshConnections();
      setNotice("本次推理已 completed，所选模型此次可访问。"); }),
    configureBackend: (executable: string) => perform(async () => { await invoke("codex_backend_configure", { executable });
      setBackend(await invoke("codex_backend_capability")); }),
  };
}
export type ResearchWorkbenchModel = ReturnType<typeof useResearchWorkbenchController>;
