import { useEffect, useState } from "react";
import { Button, Checkbox, Field, Input, Select, Textarea, Tooltip } from "@fluentui/react-components";
import { AddRegular, ArrowClockwiseRegular, DismissRegular, DocumentSaveRegular, PlayRegular } from "@fluentui/react-icons";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { DocumentExportDialog } from "../document-export/DocumentExportDialog";
import { useDocumentExportPort } from "../document-export/documentExportPort";
import { defaultExportOptions } from "../document-export/documentExport.types";
import type { ResearchWorkbenchModel } from "./researchWorkbench.types";
import "./researchWorkbench.css";

const states: Record<string, string> = { running: "进行中", waiting_user: "等待确认", waiting_job: "等待实验",
  interrupted: "已中断", exhausted: "预算已用完", completed: "交付已完成", failed: "失败", cancelled: "已取消",
  submitting: "正在核对提交", speculative: "推测", supported_under_conditions: "在所列条件下得到支持", inconclusive: "尚无定论", refuted: "已被反驳" };
export function ResearchWorkbench({ model }: { model: ResearchWorkbenchModel }) {
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
  return <section className="research-workbench" aria-label="研究工作台">
    <div className="research-toolbar"><h2>研究工作台</h2>
      <Tooltip content="刷新研究状态" relationship="description"><Button appearance="subtle" icon={<ArrowClockwiseRegular />} aria-label="刷新研究状态" onClick={() => void model.refresh()} /></Tooltip>
    </div>
    {!model.supported ? <p>研究实验需要桌面应用；浏览器当前可用于阅读与文档整理。</p> : null}
    <div className="research-grid">
      <aside className="research-tasks" aria-label="研究任务">
        <Field label="研究目标"><Textarea value={model.goal} resize="vertical" onChange={(_, data) => model.setGoal(data.value)} /></Field>
        <Button icon={<AddRegular />} disabled={!model.supported || model.busy} onClick={() => void model.createTask()}>创建研究任务</Button>
        {model.tasks.map(task => <Button key={task.taskId} disabled={model.busy} appearance={model.detail?.task.taskId === task.taskId ? "secondary" : "subtle"} onClick={() => void model.open(task.taskId)}>
          <span>{task.goal}<small>{states[task.state]} · 本机实验 {task.budget.usedRuns}/{task.budget.maxRuns}</small></span>
        </Button>)}
        <details>
          <summary>模型连接</summary>
          <p>ChatGPT 订阅与自备 API 分别管理。仅实际完成推理才能确认这次模型可访问。</p>
          <Button disabled={!model.supported || model.busy} onClick={() => void model.login()}>Continue with ChatGPT</Button>
          {model.busy ? <Button onClick={() => void model.cancelLogin()}>取消授权等待</Button> : null}
          <Field label="ChatGPT 账号"><Select value={model.connections.activeAccount ?? ""} onChange={event => void model.selectAccount(event.target.value)}>
            <option value="">请选择账号</option>{model.connections.accounts.map(account => <option key={account.id} value={account.id}>{account.name || account.email}</option>)}
          </Select></Field>
          <Field label="模型"><Select value={model.model} onChange={event => model.setModel(event.target.value)}>
            <option value="">请选择模型</option>{model.models.map(item => <option key={item.slug} value={item.slug}>{item.displayName}</option>)}
          </Select></Field>
          <Button disabled={model.busy || !model.model} onClick={() => void model.verifyModel()}>验证所选模型</Button>
          <Button disabled={model.busy || !model.connections.activeAccount} onClick={() => void model.logout()}>断开并移除本机凭据</Button>
          <Field label="研究引擎可执行文件"><Input value={executable} onChange={(_, data) => setExecutable(data.value)} /></Field>
          <p>需要 Codex {model.backend.requiredVersion}。连接只接受该版本，研究工具与目录权限由 Liteasy 限制。</p>
          <Button disabled={model.busy || !executable} onClick={() => void model.configureBackend(executable)}>连接研究引擎</Button>
          {model.backend.configured ? <small>研究引擎已连接</small> : null}
          <Field label="Python 可执行文件"><Input value={harness.python} onChange={(_, data) => setHarness({ ...harness, python: data.value })} /></Field>
          <Field label="研究校验内核目录"><Input value={harness.kitRoot} onChange={(_, data) => setHarness({ ...harness, kitRoot: data.value })} /></Field>
          <Field label="内核拥有的独立工作区"><Input value={harness.workspace} onChange={(_, data) => setHarness({ ...harness, workspace: data.value })} /></Field>
          <Button disabled={model.busy || !harness.python || !harness.kitRoot || !harness.workspace} onClick={() => void model.configureHarness(harness.python, harness.kitRoot, harness.workspace)}>连接研究校验服务</Button>
          <Field label="校验类型"><Select value={harness.operation} onChange={event => setHarness({ ...harness, operation: event.target.value })}>
            <option value="verify">工作区完整性</option><option value="create_packet">生成有界文献 packet</option><option value="literature_audit">文献 packet</option><option value="hypothesis_admission">假设准入</option><option value="execution_preflight">执行前检查</option><option value="claim_audit">主张结构审核</option>
          </Select></Field>
          <Field label="校验记录 ID"><Input value={harness.recordId} onChange={(_, data) => setHarness({ ...harness, recordId: data.value })} /></Field>
          {harness.operation === "create_packet" ? <Field label="Packet（仅引用该工作索引中的既有记录）"><Textarea value={harness.packet} onChange={(_, data) => setHarness({ ...harness, packet: data.value })} /></Field> : null}
          <Button disabled={model.busy} onClick={() => void model.checkHarness(harness.operation, harness.recordId, harness.operation === "create_packet" ? harness.packet : undefined)}>{harness.operation === "create_packet" ? "批准生成文献 packet 并校验" : "读取原内核校验回执"}</Button>
          {model.harnessReceipt ? <pre>{model.harnessReceipt}</pre> : null}
        </details>
      </aside>
      <main className="research-detail">
        {model.detail ? <>
          <div className="research-toolbar"><h3>{model.detail.task.goal}</h3><span>{states[model.detail.task.state]}</span></div>
          <p>{model.detail.task.taskBrief.nextCheck}</p>
          <fieldset><legend>来源与访问范围</legend>
            <Field label="固定来源版本"><Select value={model.source ? JSON.stringify(model.source) : ""} onChange={event => model.setSource(event.target.value ? JSON.parse(event.target.value) : undefined)}>
              <option value="">请选择来源</option>{model.sources.map(item => <option key={JSON.stringify(item.ref)} value={JSON.stringify(item.ref)}>{item.title} · {item.ref.revision.slice(0, 8)}</option>)}
            </Select></Field>
            <Button disabled={model.busy} onClick={() => void model.createSyntheticSource()}>创建 DataLoader 合成条件说明</Button>
            <Button disabled={model.busy || !model.source} onClick={() => void model.readSource()}>读取固定来源</Button>
          </fieldset>
          <fieldset><legend>假设分支</legend>
            <Field label="问题"><Textarea value={model.hypothesis.question} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, question: data.value })} /></Field>
            <Field label="可能的机制"><Textarea value={model.hypothesis.proposedMechanism} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, proposedMechanism: data.value })} /></Field>
            <Field label="改变了哪个假设"><Textarea value={model.hypothesis.changedAssumption} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, changedAssumption: data.value })} /></Field>
            <Field label="可检查的预测"><Input value={model.hypothesis.prediction} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, prediction: data.value })} /></Field>
            <Field label="证伪条件"><Textarea value={model.hypothesis.falsification} onChange={(_, data) => model.setHypothesis({ ...model.hypothesis, falsification: data.value })} /></Field>
            <Button disabled={model.busy} onClick={() => void model.saveHypothesis()}>保存推测假设</Button>
            <Field label="本次检查的假设分支"><Select value={model.hypothesisId || model.detail.records.filter(record => record.kind === "hypothesis").at(-1)?.id || ""}
              onChange={event => model.setHypothesisId(event.target.value)}>
              <option value="">请选择假设</option>{model.detail.records.filter(record => record.kind === "hypothesis").map(record =>
                <option key={record.id} value={record.id}>{String(record.body.question)} · {record.hash.slice(0, 8)}</option>)}
            </Select></Field>
            {model.detail.records.filter(record => record.kind === "hypothesis").map(record => <p key={record.id}><strong>推测：</strong>{String(record.body.question)}</p>)}
          </fieldset>
          <fieldset><legend>最小实验与独立检查</legend>
            <p>合成 CPU trace 回放；统一缓存与 I/O 预算，先检查样本、顺序与跨模态对齐，再比较等待和读取放大。</p>
            <Field label="候选方案"><Select value={model.candidate} onChange={event => model.setCandidate(event.target.value as "sequential" | "last_delta")}>
              <option value="sequential">顺序预取</option><option value="last_delta">最近差值预测</option>
            </Select></Field>
            <Button disabled={model.busy} onClick={() => void model.prepareSpec()}>准备实验规格</Button>
            {latestSpec ? <details><summary>检查固定规格 · {latestSpec.hash.slice(0, 12)}</summary><pre>{JSON.stringify(latestSpec.body, null, 2)}</pre></details> : null}
            <Checkbox checked={allowExperiment} label="批准本规格的本机小实验：不联网，不执行任意脚本" onChange={(_, data) => setAllowExperiment(Boolean(data.checked))} />
            <Button icon={<PlayRegular />} disabled={model.busy || executing || !allowExperiment || !latestSpec} onClick={() => void model.approveAndRun()}>批准并运行本规格</Button>
            {model.detail.runs.map(run => <article key={run.runId} className="research-run">
              <div className="research-toolbar"><strong>{run.runId.slice(0, 20)}</strong><span>{states[run.status]}</span>
                {["submitting", "running"].includes(run.status) ? <Tooltip content="取消本次实验" relationship="description"><Button icon={<DismissRegular />} aria-label="取消本次实验" onClick={() => void model.cancelRun(run.runId)} /></Tooltip> : null}</div>
              {run.error ? <p>{run.error}</p> : null}
              {run.rawResult ? <><p>正确性：{run.rawResult.correctnessPassed ? "通过" : "未通过"}；{states[run.rawResult.conditionalStatus] ?? run.rawResult.conditionalStatus}</p>
                <table><thead><tr><th>工作负载</th><th>算法</th><th>模拟等待 P95 μs</th><th>读取放大</th><th>缓存峰值字节</th><th>回放耗时 μs</th></tr></thead><tbody>
                  {run.rawResult.outputs.map(output => <tr key={output.workload + output.algorithm}><td>{output.workload}</td><td>{output.algorithm}</td><td>{output.metrics.simulatedWaitP95Us}</td><td>{output.metrics.readAmplification.toFixed(3)}</td><td>{output.metrics.cachePeakBytes}</td><td>{output.metrics.replayWallUs}</td></tr>)}
                </tbody></table><ul>{run.rawResult.conditions.map(value => <li key={value}>{value}</li>)}</ul>
                <details><summary>原始结果预览{JSON.stringify(run).length > 32000 ? "（前 32,000 字符）" : ""}</summary><pre>{JSON.stringify(run, null, 2).slice(0, 32000)}</pre></details>
              </> : null}
            </article>)}
          </fieldset>
          <fieldset><legend>决策与条件化结论</legend>
            <Field label="本次决策依据的实验"><Select value={latestRun?.runId ?? ""} onChange={event => model.setRunId(event.target.value)}>
              <option value="">请选择实验</option>{model.detail.runs.map(run => <option key={run.runId} value={run.runId}>{run.runId} · {states[run.status]}</option>)}
            </Select></Field>
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
                  <Button key={index} disabled={model.busy} onClick={() => void model.readEvidence(span.reference)}>查看原始依据 · {span.reference.revision.slice(0, 8)} · {span.offset}–{span.endOffset}</Button>)}
              </article>;
            })}
            <Checkbox label="我已核对原始输出与适用条件，仅确认这些条件下的主张" checked={reviewed} onChange={(_, data) => setReviewed(Boolean(data.checked))} />
            <Button disabled={model.busy || !reviewed || !model.detail.records.some(record => record.kind === "claim")} onClick={() => void model.confirmClaim()}>记录人工确认</Button>
            <Button icon={<DocumentSaveRegular />} disabled={model.busy} onClick={() => void model.saveReport()}>保存证据报告到笔记</Button>
            <Button disabled={model.busy || !exportPort} onClick={() => setExportOpen(true)}>导出报告与原始证据</Button>
          </fieldset>
          <fieldset><legend>研究助手</legend>
            <Checkbox checked={allowModel} label="允许将所选固定资料与本任务发送给所选 ChatGPT 账号" onChange={(_, data) => setAllowModel(Boolean(data.checked))} />
            <Button disabled={model.busy || !allowModel} onClick={() => void model.approveModel()}>批准本任务连接</Button>
            <Button disabled={model.busy || !allowModel} onClick={() => void model.askResearch()}>请研究助手检查与提出方案</Button>
            {model.modelRun ? <Button onClick={() => void model.cancelModel()}>取消研究推理</Button> : null}
            <ContentView streaming={Boolean(model.modelRun)} mediaPolicy="blocked" content={legacyContent(model.answer)} />
          </fieldset>
        </> : <p>先创建一个研究目标。探索假设可随时保存；测量和结论升级通过固定规格与实际运行核验。</p>}
        {model.notice ? <pre className="research-notice" role="status">{model.notice}</pre> : null}
        {exportNotice ? <p role="status">{exportNotice}</p> : null}
      </main>
    </div>
    {exportOpen && exportPort ? <DocumentExportDialog title="导出研究证据" open initialFormat="markdown"
      compile={(options, signal) => model.compileReport({ ...defaultExportOptions, ...options }, signal)}
      publish={exportPort.publish} onClose={() => setExportOpen(false)}
      onOutcome={outcome => setExportNotice(outcome.status === "saved" ? "研究证据文件已保存。" : outcome.status === "download_started" ? "已交给浏览器下载，保存位置由浏览器管理。" : "导出已取消。")} /> : null}
  </section>;
}
