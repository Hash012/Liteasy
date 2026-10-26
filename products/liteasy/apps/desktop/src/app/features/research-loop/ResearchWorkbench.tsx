import { ActionButton as Button, DisclosureSection, InlineNotice, OptionPicker } from "../../shared/ui/productPrimitives";
import { useEffect, useState } from "react";
import { Checkbox, Field, Input, Textarea, Tooltip } from "@fluentui/react-components";
import { AddRegular, ArrowClockwiseRegular, DismissRegular, DocumentSaveRegular, PlayRegular } from "@fluentui/react-icons";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { DocumentExportDialog } from "../document-export/DocumentExportDialog";
import { useDocumentExportPort } from "../document-export/documentExportPort";
import { defaultExportOptions } from "../document-export/documentExport.types";
import type { ResearchWorkbenchModel } from "./researchWorkbench.types";
import "./researchWorkbench.css";
import { researchRunLabel } from "./researchPresentation";

const states: Record<string, string> = { running: "进行中", waiting_user: "等待确认", waiting_job: "等待实验",
  interrupted: "已中断", exhausted: "预算已用完", completed: "交付已完成", failed: "失败", cancelled: "已取消",
  submitting: "正在核对提交", speculative: "推测", supported_under_conditions: "在所列条件下得到支持", inconclusive: "尚无定论", refuted: "已被反驳" };
export function ResearchWorkbench({ model }: { model: ResearchWorkbenchModel }) {
  const [stage, setStage] = useState("来源与访问范围");
  useEffect(() => { setStage("来源与访问范围"); }, [model.detail?.task.taskId]);
  const exportPort = useDocumentExportPort();
  const [exportOpen, setExportOpen] = useState(false), [exportNotice, setExportNotice] = useState(""), [reviewed, setReviewed] = useState(false);
  const [allowExperiment, setAllowExperiment] = useState(false), [allowModel, setAllowModel] = useState(false);
  const [executable, setExecutable] = useState(""), [rationale, setRationale] = useState("保留顺序访问条件下的结果；held-out 未改善，不扩大到其他工作负载。");
  const [harness, setHarness] = useState({ python: "", kitRoot: "", workspace: "", operation: "verify", recordId: "", packet: "" });
  const latestSpec = model.detail?.records.filter(record => record.kind === "spec").at(-1);
  const latestClaim = model.detail?.records.filter(record => record.kind === "claim").at(-1);
  useEffect(() => { setAllowExperiment(false); }, [latestSpec?.hash]);
  useEffect(() => { setReviewed(false); }, [latestClaim?.hash, model.detail?.task.taskId]);
  useEffect(() => { setAllowModel(false); }, [model.source, model.model, model.connections.activeAccount, model.detail?.task.taskId]);
  const latestRun = model.detail?.runs.find(run => run.runId === model.runId) ?? model.detail?.runs.at(-1);
  const executing = model.detail?.task.state === "running" || model.detail?.task.state === "waiting_job";
  const connectionMessage = model.connectionStatus?.message.includes("chatgpt_discovery_failed")
    ? "无法读取 ChatGPT 连接信息。请检查网络和登录状态后重试连接。" : model.connectionStatus?.message;
  return <section className="research-workbench" aria-label="研究工作台">
    <div className="research-toolbar"><h2>研究工作台</h2>
      <Tooltip content="刷新研究状态" relationship="description"><Button disabled={model.busy} appearance="subtle" icon={<ArrowClockwiseRegular />} aria-label="刷新研究状态" onClick={() => void model.refresh()} /></Tooltip>
    </div>
    {!model.supported ? <InlineNotice message="研究实验需要桌面应用；浏览器当前可用于阅读与文档整理。" /> : null}
    {model.busy && model.pendingAction !== "login" && model.pendingAction !== "connection" ? <InlineNotice intent="busy" message="正在处理研究操作，请稍候…" /> : null}
    <div className="research-grid">
      <section className="research-tasks research-card" aria-label="研究任务">
        <h3>研究目标与任务</h3>
        <p className="research-description">先创建一个研究目标。探索假设可随时保存；测量和结论升级通过固定规格与实际运行核验。</p>
        <Field label="研究目标"><Textarea rows={4} value={model.goal} resize="vertical" onChange={(_, data) => model.setGoal(data.value)} /></Field>
        <Button className="research-create-task" appearance="primary" icon={<AddRegular />} disabled={!model.supported || model.busy} onClick={() => void model.createTask()}>创建研究任务</Button>
        {model.tasks.length ? <ul className="research-task-list">{model.tasks.map(task => <li key={task.taskId}><Button className="research-task" disabled={model.busy} aria-pressed={model.detail?.task.taskId === task.taskId} onClick={() => void model.open(task.taskId)}>
          <span>{task.goal}<small>{states[task.state] ?? task.state} · 本机实验 {task.budget.usedRuns}/{task.budget.maxRuns}</small></span>
        </Button></li>)}</ul> : <p className="research-description">暂无研究任务，填写目标后即可创建。</p>}
      </section>
      <section className="research-card research-connection" aria-label="模型连接配置">
        {model.connectionStatus && connectionMessage ? <InlineNotice intent={model.connectionStatus.intent} message={connectionMessage} /> : null}
        {model.connectionStatus && connectionMessage !== model.connectionStatus.message ? <DisclosureSection title="连接诊断详情"><pre>{model.connectionStatus.message}</pre></DisclosureSection> : null}
        {model.pendingAction === "login" || model.pendingAction === "connection" ? <InlineNotice intent="busy" message={model.pendingAction === "login" ? "正在等待 ChatGPT 授权，可在下方取消。" : "正在处理连接操作，请稍候…"} /> : null}
        <DisclosureSection title="模型连接" defaultOpen>
          <p className="research-description">ChatGPT 订阅与自备 API 分别管理。仅实际完成推理才能确认这次模型可访问。</p>
          <div className="research-actions">
            <Button className="research-login" disabled={!model.supported || model.busy} onClick={() => void model.login()}>Continue with ChatGPT</Button>
            {model.pendingAction === "login" ? <Button onClick={() => void model.cancelLogin()}>取消授权等待</Button> : null}
          </div>
          <div className="research-connection-fields">
            <Field label="ChatGPT 账号" hint={!model.connections.accounts.length ? "连接 ChatGPT 后，可选择已授权账号。" : undefined}><OptionPicker aria-label="ChatGPT 账号" disabled={model.busy || !model.connections.accounts.length} value={model.connections.activeAccount ?? ""} onValueChange={(value) => void model.selectAccount(value)} options={[{ value: "", label: "请选择账号" }, ...model.connections.accounts.map(account => ({ value: account.id, label: account.name || account.email }))]} /></Field>
            <Field label="模型" hint={!model.models.length ? "选定账号并读取可用模型后，可进行验证。" : undefined}><OptionPicker aria-label="模型" disabled={model.busy || !model.connections.activeAccount || !model.models.length} value={model.model} onValueChange={model.setModel} options={[{ value: "", label: "请选择模型" }, ...model.models.map(item => ({ value: item.slug, label: item.displayName }))]} /></Field>
          </div>
          <div className="research-actions">
            <Button disabled={model.busy || !model.model || !model.connections.activeAccount} onClick={() => void model.verifyModel()}>验证所选模型</Button>
            <Button className="research-disconnect" disabled={model.busy || !model.connections.activeAccount} onClick={() => void model.logout()}>断开并移除本机凭据</Button>
          </div>
          <DisclosureSection title="研究引擎与校验服务">
          <Field label="研究引擎可执行文件"><Input value={executable} onChange={(_, data) => setExecutable(data.value)} /></Field>
          <p>需要 Codex {model.backend.requiredVersion}。连接只接受该版本，研究工具与目录权限由 Liteasy 限制。</p>
          <Button disabled={model.busy || !executable} onClick={() => void model.configureBackend(executable)}>连接研究引擎</Button>
          {model.backend.configured ? <small>研究引擎已连接</small> : null}
          <Field label="Python 可执行文件"><Input value={harness.python} onChange={(_, data) => setHarness({ ...harness, python: data.value })} /></Field>
          <Field label="研究校验内核目录"><Input value={harness.kitRoot} onChange={(_, data) => setHarness({ ...harness, kitRoot: data.value })} /></Field>
          <Field label="内核拥有的独立工作区"><Input value={harness.workspace} onChange={(_, data) => setHarness({ ...harness, workspace: data.value })} /></Field>
          <Button disabled={model.busy || !harness.python || !harness.kitRoot || !harness.workspace} onClick={() => void model.configureHarness(harness.python, harness.kitRoot, harness.workspace)}>连接研究校验服务</Button>
          <Field label="校验类型"><OptionPicker aria-label="校验类型" value={harness.operation} onValueChange={(value) => setHarness({ ...harness, operation: value })} options={[{ value: "verify", label: "工作区完整性" }, { value: "create_packet", label: "生成有界文献 packet" }, { value: "literature_audit", label: "文献 packet" }, { value: "hypothesis_admission", label: "假设准入" }, { value: "execution_preflight", label: "执行前检查" }, { value: "claim_audit", label: "主张结构审核" }]} /></Field>
          <Field label="校验记录 ID"><Input value={harness.recordId} onChange={(_, data) => setHarness({ ...harness, recordId: data.value })} /></Field>
          {harness.operation === "create_packet" ? <Field label="Packet（仅引用该工作索引中的既有记录）"><Textarea value={harness.packet} onChange={(_, data) => setHarness({ ...harness, packet: data.value })} /></Field> : null}
          <Button disabled={model.busy} onClick={() => void model.checkHarness(harness.operation, harness.recordId, harness.operation === "create_packet" ? harness.packet : undefined)}>{harness.operation === "create_packet" ? "批准生成文献 packet 并校验" : "读取原内核校验回执"}</Button>
          {model.harnessReceipt ? <pre>{model.harnessReceipt}</pre> : null}
          </DisclosureSection>
        </DisclosureSection>
      </section>
      <div className="research-detail research-card" hidden={!model.detail && !model.notice && !exportNotice}>
        {model.detail ? <>
          <div className="research-toolbar"><h3>{model.detail.task.goal}</h3><span>{states[model.detail.task.state]}</span></div>
          <p>{model.detail.task.taskBrief.nextCheck} · 本机实验预算 {model.detail.task.budget.usedRuns}/{model.detail.task.budget.maxRuns}</p>
          {model.detail.runs.filter(run => ["submitting", "running"].includes(run.status)).map(run => <Button key={run.runId} onClick={() => void model.cancelRun(run.runId)}>取消本次实验</Button>)}
          {latestClaim ? <p>条件化结论：{states[String(latestClaim.body.status)] ?? "待核对"} · 需核对适用条件与独立检查</p> : null}
          <nav className="research-toolbar" aria-label="研究阶段">{["来源与访问范围", "假设分支", "最小实验与独立检查", "决策与条件化结论", "研究助手"].map(name => <Button key={name} appearance={stage === name ? "primary" : "subtle"} aria-pressed={stage === name} onClick={() => setStage(name)}>{name}</Button>)}</nav>
          <fieldset hidden={stage !== "来源与访问范围"}><legend>来源与访问范围</legend>
            <Field label="固定来源版本"><OptionPicker aria-label="固定来源版本" value={model.source ? JSON.stringify(model.source) : ""} onValueChange={(value) => model.setSource(value ? JSON.parse(value) : undefined)} options={[{ value: "", label: "请选择来源" }, ...model.sources.map(item => ({ value: JSON.stringify(item.ref), label: `${item.title} · 已固定版本` }))]} /></Field>
            <Button disabled={model.busy} onClick={() => void model.createSyntheticSource()}>创建 DataLoader 合成条件说明</Button>
            <Button disabled={model.busy || !model.source} onClick={() => void model.readSource()}>读取固定来源</Button>
          </fieldset>
          <fieldset hidden={stage !== "假设分支"}><legend>假设分支</legend>
            <Field label="问题"><Textarea value={model.hypothesis.question} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, question: data.value })} /></Field>
            <Field label="可能的机制"><Textarea value={model.hypothesis.proposedMechanism} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, proposedMechanism: data.value })} /></Field>
            <Field label="改变了哪个假设"><Textarea value={model.hypothesis.changedAssumption} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, changedAssumption: data.value })} /></Field>
            <Field label="可检查的预测"><Input value={model.hypothesis.prediction} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, prediction: data.value })} /></Field>
            <Field label="证伪条件"><Textarea value={model.hypothesis.falsification} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, falsification: data.value })} /></Field>
            <Button disabled={model.busy} onClick={() => void model.saveHypothesis()}>保存推测假设</Button>
            <Field label="本次检查的假设分支"><OptionPicker aria-label="本次检查的假设分支" value={model.hypothesisId || model.detail.records.filter(record => record.kind === "hypothesis").at(-1)?.id || ""} onValueChange={model.setHypothesisId} options={[{ value: "", label: "请选择假设" }, ...model.detail.records.filter(record => record.kind === "hypothesis").map((record, index) => ({ value: record.id, label: `${String(record.body.question)} · 方案 ${index + 1}` }))]} /></Field>
            {model.detail.records.filter(record => record.kind === "hypothesis").map(record => <p key={record.id}><strong>推测：</strong>{String(record.body.question)}</p>)}
          </fieldset>
          <fieldset hidden={stage !== "最小实验与独立检查"}><legend>最小实验与独立检查</legend>
            <p>合成 CPU trace 回放；统一缓存与 I/O 预算，先检查样本、顺序与跨模态对齐，再比较等待和读取放大。</p>
            <Field label="候选方案"><OptionPicker aria-label="候选方案" value={model.candidate} onValueChange={(value) => model.setCandidate(value as "sequential" | "last_delta")} options={[{ value: "sequential", label: "顺序预取" }, { value: "last_delta", label: "最近差值预测" }]} /></Field>
            <Button disabled={model.busy} onClick={() => void model.prepareSpec()}>准备实验规格</Button>
            {latestSpec ? <DisclosureSection title="检查本次实验规格"><p>原始规格与校验信息（技术数据）</p><pre>{JSON.stringify(latestSpec, null, 2)}</pre></DisclosureSection> : null}
            <Checkbox checked={allowExperiment} label="批准本规格的本机小实验：不联网，不执行任意脚本" onChange={(_, data) => setAllowExperiment(Boolean(data.checked))} />
            <Button icon={<PlayRegular />} disabled={model.busy || executing || !allowExperiment || !latestSpec} onClick={() => void model.approveAndRun()}>批准并运行本规格</Button>
            {model.detail.runs.map(run => <article key={run.runId} className="research-run">
              <div className="research-toolbar"><strong>{researchRunLabel(model.detail!, run)}</strong><span>{states[run.status]}</span>
                </div>
              {run.error ? <p>{run.error}</p> : null}
              {run.rawResult ? <><p>正确性：{run.rawResult.correctnessPassed ? "通过" : "未通过"}；{states[run.rawResult.conditionalStatus] ?? run.rawResult.conditionalStatus}</p>
                <table><thead><tr><th>工作负载</th><th>算法</th><th>模拟等待 P95 μs</th><th>读取放大</th><th>缓存峰值字节</th><th>回放耗时 μs</th></tr></thead><tbody>
                  {run.rawResult.outputs.map(output => <tr key={output.workload + output.algorithm}><td>{output.workload}</td><td>{output.algorithm}</td><td>{output.metrics.simulatedWaitP95Us}</td><td>{output.metrics.readAmplification.toFixed(3)}</td><td>{output.metrics.cachePeakBytes}</td><td>{output.metrics.replayWallUs}</td></tr>)}
                </tbody></table><ul>{run.rawResult.conditions.map(value => <li key={value}>{value}</li>)}</ul>
                <DisclosureSection title={`原始结果预览${JSON.stringify(run).length > 32000 ? "（前 32,000 字符）" : ""}`}><pre>{JSON.stringify(run, null, 2).slice(0, 32000)}</pre></DisclosureSection>
              </> : null}
            </article>)}
          </fieldset>
          <fieldset hidden={stage !== "决策与条件化结论"}><legend>决策与条件化结论</legend>
            <Field label="本次决策依据的实验"><OptionPicker aria-label="本次决策依据的实验" value={latestRun?.runId ?? ""} onValueChange={model.setRunId} options={[{ value: "", label: "请选择实验" }, ...model.detail.runs.map(run => ({ value: run.runId, label: `${researchRunLabel(model.detail!, run)} · ${states[run.status]}` }))]} /></Field>
            <Field label="继续、收缩或停止的依据"><Textarea value={rationale} onChange={(_, data) => setRationale(data.value)} /></Field>
            <Button disabled={model.busy || executing || latestRun?.status !== "completed"} onClick={() => void model.recordDecision("narrow", rationale)}>记录收缩结论</Button>
            <Button disabled={model.busy || executing || !latestRun} onClick={() => void model.recordDecision("stop", rationale)}>记录停止决策</Button>
            <Button disabled={model.busy || executing || !latestRun} onClick={() => void model.recordDecision("continue", rationale)}>记录继续检查</Button>
            {model.detail.records.filter(record => record.kind === "claim").map(record => {
              const reviewed = model.detail!.records.some(review => review.kind === "review"
                && (review.body.claimRef as { hash?: string } | undefined)?.hash === record.hash);
              return <article key={record.id}>
                <p>条件化主张：{states[String(record.body.status)]}；{reviewed ? "已记录人工确认" : "语义支持待人工复核"}，新颖性尚未判断。</p>
                <ul>{(record.body.conditions as string[] ?? []).map((condition, index) => <li key={index}>{condition}</li>)}</ul>
                {(record.body.evidenceSpans as Array<{ reference: { objectId: string; revision: string }; offset: number; endOffset: number }> ?? []).map((span, index) =>
                  <Button key={index} disabled={model.busy} onClick={() => void model.readEvidence(span.reference)}>查看原始依据 {index + 1} · 字符 {span.offset}–{span.endOffset}</Button>)}
              </article>;
            })}
            <Checkbox label="我已核对原始输出与适用条件，仅确认这些条件下的主张" checked={reviewed} onChange={(_, data) => setReviewed(Boolean(data.checked))} />
            <Button disabled={model.busy || !reviewed || !model.detail.records.some(record => record.kind === "claim")} onClick={() => void model.confirmClaim()}>记录人工确认</Button>
            <Button icon={<DocumentSaveRegular />} disabled={model.busy} onClick={() => void model.saveReport()}>保存证据报告到笔记</Button>
            <Button disabled={model.busy || !exportPort} onClick={() => setExportOpen(true)}>导出报告与原始证据</Button>
          </fieldset>
          <fieldset hidden={stage !== "研究助手"}><legend>研究助手</legend>
            <Checkbox checked={allowModel} label="允许将所选固定资料与本任务发送给所选 ChatGPT 账号" onChange={(_, data) => setAllowModel(Boolean(data.checked))} />
            <Button disabled={model.busy || !allowModel} onClick={() => void model.approveModel()}>批准本任务连接</Button>
            <Button disabled={model.busy || !allowModel} onClick={() => void model.askResearch()}>请研究助手检查与提出方案</Button>
            {model.modelRun ? <Button onClick={() => void model.cancelModel()}>取消研究推理</Button> : null}
            <ContentView streaming={Boolean(model.modelRun)} mediaPolicy="blocked" content={legacyContent(model.answer)} />
          </fieldset>
        </> : null}
        {model.notice ? <div className="research-notice"><InlineNotice intent={model.noticeIntent ?? "info"} message={model.notice} /></div> : null}
        {exportNotice ? <p role="status">{exportNotice}</p> : null}
      </div>
    </div>
    {exportOpen && exportPort ? <DocumentExportDialog jobScope={exportPort.jobScope} sourceIdentity={JSON.stringify(model.detail)} title="导出研究证据" open initialFormat="markdown"
      compile={(options, signal) => model.compileReport({ ...defaultExportOptions, ...options }, signal)}
      publish={exportPort.publish} onClose={() => setExportOpen(false)}
      onOutcome={outcome => setExportNotice(outcome.status === "saved" ? "研究证据文件已保存。" : outcome.status === "download_started" ? "已交给浏览器下载，保存位置由浏览器管理。" : "导出已取消。")} /> : null}
  </section>;
}
