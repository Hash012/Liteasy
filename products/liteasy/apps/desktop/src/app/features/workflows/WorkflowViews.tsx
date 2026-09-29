import { useEffect, useState } from "react";
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Checkbox, Input, Textarea } from "@fluentui/react-components";
import type { ExtensionWorkflowModel } from "./extensionWorkflowModel";
import { useExtensionWorkbench } from "../extensions/extensionWorkbenchContext";
import { SchemaFields } from "../extensions/SchemaFields";
import { parseDataSchema, type JsonObject } from "../extensions/extensionSchema";
import type { AgentAsset } from "../resource-filesystem/agentAsset.types";
import type { WorkflowRun } from "./workflowRunner";
import { downloadExtensionJson } from "../extensions/ExtensionViews";
import { RichTextBlock } from "../visual-blocks/VisualBlockBase";

export function WorkflowInvocation({ model }: { model: ExtensionWorkflowModel }) {
  const pending = model.pending;
  const [value, setValue] = useState<JsonObject>({}), [selection, setSelection] = useState<string[]>([]), [query, setQuery] = useState("");
  const [assets, setAssets] = useState<AgentAsset[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [valid, setValid] = useState(true);
  useEffect(() => { setValue(pending?.input ?? {}); setSelection(pending?.selection ?? []); setError(""); }, [pending]);
  useEffect(() => { if (!pending) return; const abort = new AbortController(); const timer = setTimeout(() => { void model.assets.search({ query, limit: 30, signal: abort.signal }).then(setAssets).catch((e) => { if (!abort.signal.aborted) setError(String(e)); }); }, 150); return () => { abort.abort(); clearTimeout(timer); }; }, [pending, query, model.assets]);
  if (!pending) return null;
  const schema = parseDataSchema(pending.definition.inputSchema);
  const { selection: _selection, ...properties } = schema.properties ?? {};
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) model.close(); }}><DialogSurface><DialogBody><DialogTitle>{pending.definition.title}</DialogTitle><DialogContent>
    <p>先选资料，再运行。只读取选中资源；新产物保存在当前用户的 Liteasy 资产库。</p>
    <Input aria-label="搜索工作流资料" value={query} placeholder="搜索论文或笔记" onChange={(_, data) => setQuery(data.value)} />
    <div className="workflow-resource-picker">{assets.map((asset) => <Checkbox key={asset.path} label={asset.title} checked={selection.includes(asset.path)} onChange={(_, data) => setSelection((items) => data.checked ? [...new Set([...items, asset.path])] : items.filter((path) => path !== asset.path))} />)}</div>
    <p>已选 {selection.length} 项资料</p><SchemaFields schema={{ ...schema, properties }} value={value} onChange={setValue} onValidityChange={setValid} />
    <details><summary>操作范围与预算</summary><p>{pending.capabilities.join("、")}</p><p>模型：{model.connection} · 最多 {pending.definition.budget.maxModelCalls} 次调用 · {pending.definition.budget.maxTokens} tokens</p><p>模型用量按文本估算；输出会经过结构校验后保存。</p></details>
    {error ? <p role="alert">{error}</p> : null}
  </DialogContent><DialogActions><Button disabled={busy} onClick={model.close}>取消</Button><Button appearance="primary" disabled={busy || !valid} onClick={() => { setBusy(true); void model.start({ ...value, ...(schema.properties?.selection ? { selection } : {}) }, selection).catch((e) => setError(String(e))).finally(() => setBusy(false)); }}>开始运行</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}
const labels: Record<string, string> = { queued: "排队", running: "进行中", waiting_input: "等待补充", paused: "暂停", succeeded: "完成", failed: "失败", cancelled: "已取消", partial: "部分完成", skipped: "跳过", pending: "待执行" };
export function WorkflowRuns() {
  const host = useExtensionWorkbench(), model = host?.workflows;
  const [runs, setRuns] = useState<WorkflowRun[]>([]), [selected, setSelected] = useState<string>(), [detail, setDetail] = useState<Awaited<ReturnType<NonNullable<typeof model>["runner"]["replay"]>>>();
  const [error, setError] = useState(""), [response, setResponse] = useState("");
  useEffect(() => { if (!model) return; let alive = true; const reload = () => void model.runner.list().then((items) => { if (alive) setRuns(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }).catch((e) => { if (alive) setError(String(e)); }); reload(); const dispose = model.runner.subscribe(reload); return () => { alive = false; dispose(); }; }, [model?.runner]);
  useEffect(() => { if (!model || !selected) return; let alive = true; void model.runner.replay(selected).then((result) => { if (alive) setDetail(result); }).catch((e) => { if (alive) setError(String(e)); }); return () => { alive = false; }; }, [model?.runner, selected, runs]);
  if (!model) return <p>工作流尚未加载。</p>;
  const act = (action: () => Promise<unknown>) => { setError(""); void action().catch((e) => setError(String(e))); };
  return <section className="extension-page"><header><div><h1>运行记录</h1><p>记录回放不会重新调用模型、访问网络或写入资产。</p></div></header>{error || model.error ? <p role="alert">{error || model.error}</p> : null}
    <div className="workflow-run-layout"><nav aria-label="工作流运行">{runs.map((run) => <Button key={run.id} appearance={selected === run.id ? "secondary" : "subtle"} onClick={() => setSelected(run.id)}>{run.definition.title} · {labels[run.status]}<small>{new Date(run.createdAt).toLocaleString()}</small></Button>)}</nav>
    {detail ? <article><h2>{detail.run.definition.title}</h2><p>{labels[detail.run.status]} · {(detail.run.elapsedMs / 1000).toFixed(1)} 秒 · 预算占用约 {detail.run.tokens} / {detail.run.definition.budget.maxTokens} tokens</p>
      <div className="extension-toolbar"><Button disabled={["succeeded", "cancelled", "running"].includes(detail.run.status)} onClick={() => act(() => model.runner.execute(detail.run.id, detail.run.status === "waiting_input" ? { response } : {}))}>继续</Button><Button disabled={["succeeded", "cancelled", "running"].includes(detail.run.status)} onClick={() => act(() => model.runner.execute(detail.run.id, { singleStep: true }))}>单步</Button><Button disabled={detail.run.status !== "running"} onClick={() => act(() => model.runner.stop(detail.run.id, "paused"))}>暂停</Button><Button disabled={["succeeded", "cancelled"].includes(detail.run.status)} onClick={() => act(() => model.runner.stop(detail.run.id, "cancelled"))}>取消</Button><Button disabled={detail.run.status === "running" || detail.run.snapshotsCleared} onClick={() => act(async () => { const previous = detail.run; const next = await model.runner.create({ owner: previous.owner, digest: previous.digest, definition: previous.definition, input: previous.input, settings: previous.settings, grantId: previous.grantId, parentRunId: previous.id }); setSelected(next.id); await model.runner.execute(next.id); })}>重新调用（新运行）</Button><Button onClick={() => downloadExtensionJson("workflow-run.json", detail)}>导出记录</Button><Button onClick={() => act(() => model.runner.clearSnapshots(detail.run.id))}>清理正文快照</Button></div>
      {detail.run.status === "waiting_input" ? <Textarea aria-label="补充运行输入" value={response} onChange={(_, data) => setResponse(data.value)} /> : null}
      {detail.run.error ? <p role="status">{detail.run.error}</p> : null}{detail.missing.length ? <p>缺少快照：{detail.missing.join("、")}，无法完整回放。</p> : null}
      {detail.run.definition.nodes.map((node) => <details key={node.id}><summary>{node.title} · {labels[detail.run.nodes[node.id].status]} · {detail.run.nodes[node.id].attempts} 次尝试</summary><p>{detail.run.nodes[node.id].error}</p>{detail.run.nodes[node.id].operations.map((id) => <details key={id}><summary>操作回执 · {detail.receipts[id]?.status ?? "待核对"}</summary><pre>{JSON.stringify(detail.receipts[id], null, 2)}</pre></details>)}{detail.nodes[node.id] !== undefined ? typeof detail.nodes[node.id] === "string" ? <RichTextBlock text={String(detail.nodes[node.id])} onOpenPath={host.openLink} /> : <pre>{JSON.stringify(detail.nodes[node.id], null, 2)}</pre> : null}</details>)}
    </article> : <p>选择记录查看实际步骤和保存结果。</p>}</div>
  </section>;
}
