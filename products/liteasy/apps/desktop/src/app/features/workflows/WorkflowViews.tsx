import { OperationFailureNotice } from "../local-diagnostics/OperationFailureNotice";
import { redactDiagnostic } from "../context/objectContext";
import { DisclosureSection, OptionPicker, IconAction } from "../../shared/ui/productPrimitives";
import { MoreHorizontalRegular, PlayRegular, ArrowRedoRegular, DocumentEditRegular, ArrowSyncRegular, ArrowExportRegular, DeleteRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Checkbox, Input, Textarea } from "@fluentui/react-components";
import type { ExtensionWorkflowModel } from "./extensionWorkflowModel";
import { useExtensionWorkbench } from "../extensions/extensionWorkbenchContext";
import { SchemaFields } from "../extensions/SchemaFields";
import { parseDataSchema, type JsonObject } from "../extensions/extensionSchema";
import type { AgentAsset } from "../resource-filesystem/agentAsset.types";
import type { WorkflowRun } from "./workflowRunner";
import { downloadExtensionJson } from "../extensions/ExtensionViews";
import { RichTextBlock } from "../visual-blocks/VisualBlockBase";
import { researchTemplates } from "./researchTemplates";

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
    <p>先选资料，再运行。只读取选中资源；新产物保存在当前用户的 Liteasy 资产库。{pending.definition.budget.maxModelCalls === 0 ? "此模板整理来源与待核查项，不调用模型；再次运行会保存新笔记。" : ""}</p>
    <Input aria-label="搜索工作流资料" value={query} placeholder="搜索论文或笔记" onChange={(_, data) => setQuery(data.value)} />
    <div className="workflow-resource-picker">{assets.map((asset) => <Checkbox key={asset.path} label={asset.title} checked={selection.includes(asset.path)} onChange={(_, data) => setSelection((items) => data.checked ? [...new Set([...items, asset.path])] : items.filter((path) => path !== asset.path))} />)}</div>
    <p>已选 {selection.length} 项资料</p><SchemaFields schema={{ ...schema, properties }} value={value} onChange={setValue} onValidityChange={setValid} />
    <section aria-label="操作范围与预算"><p>操作范围：{pending.capabilities.map((capability) => ({ "resources.metadata.read": "读取资料题录", "resources.content.read": "读取选中资料正文", "resources.create": "创建资产", "resources.write": "修改资料", "model.invoke": "向当前模型发送任务内容" } as Record<string, string>)[capability] ?? capability).join("、") || "仅计算流程输入"}</p><p>{pending.definition.budget.maxModelCalls ? `外发对象：${model.connection} · 最多 ${pending.definition.budget.maxModelCalls} 次调用 · ${pending.definition.budget.maxTokens} tokens` : "模型调用预算：0 次，不向模型发送内容。"}</p><DisclosureSection title="预算详情"><p>模型用量按文本估算；输出会经过结构校验后保存。</p><p>能力标识：{pending.capabilities.join("、") || "无"}</p></DisclosureSection></section>
    <OperationFailureNotice error={error} fallback="任务未能开始，请检查输入资料后重试。" />
  </DialogContent><DialogActions><Button disabled={busy} onClick={model.close}>取消</Button><Button appearance="primary" disabled={busy || !valid} onClick={() => { setBusy(true); void model.start({ ...value, ...(schema.properties?.selection ? { selection } : {}) }, selection).catch((e) => setError(String(e))).finally(() => setBusy(false)); }}>开始运行</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}
const labels: Record<string, string> = { queued: "排队", running: "进行中", waiting_input: "等待补充", paused: "暂停", succeeded: "完成", failed: "失败", cancelled: "已取消", partial: "部分完成", skipped: "跳过", pending: "待执行" };
export function WorkflowRuns() {
  const host = useExtensionWorkbench(), model = host?.workflows;
  const [runs, setRuns] = useState<WorkflowRun[]>([]), [selected, setSelected] = useState<string>(), [detail, setDetail] = useState<Awaited<ReturnType<NonNullable<typeof model>["runner"]["replay"]>>>();
  const [error, setError] = useState(""), [response, setResponse] = useState("");
  const [recomputed, setRecomputed] = useState<Awaited<ReturnType<NonNullable<typeof model>["runner"]["recompute"]>>>();
  const [triggerKind, setTriggerKind] = useState<"startup" | "resource" | "interval">("resource"), [minutes, setMinutes] = useState("60"), [triggers, setTriggers] = useState<import("./workflowTriggers").WorkflowTrigger[]>([]);
  useEffect(() => { if (model) void model.triggers.list().then(setTriggers); }, [model?.triggers, runs]);
  useEffect(() => { if (!model) return; let alive = true; const reload = () => void model.runner.list().then((items) => { if (alive) setRuns(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }).catch((e) => { if (alive) setError(String(e)); }); reload(); const dispose = model.runner.subscribe(reload); return () => { alive = false; dispose(); }; }, [model?.runner]);
  useEffect(() => { if (!model || !selected) return; let alive = true; void model.runner.replay(selected).then((result) => { if (alive) setDetail(result); }).catch((e) => { if (alive) setError(String(e)); }); return () => { alive = false; }; }, [model?.runner, selected, runs]);
  if (!model) return <p>工作流尚未加载。</p>;
  const worksheet = detail?.nodes.worksheet;
  const worksheetText = detail && researchTemplates.some((template) => template.id === detail.run.definition.id) && worksheet && typeof worksheet === "object" && !Array.isArray(worksheet) && typeof worksheet.text === "string" ? worksheet.text : undefined;
  const act = (action: () => Promise<unknown>) => { setError(""); void action().catch((e) => setError(String(e))); };
  return <section className="extension-page"><header><div><h1>运行记录</h1><p>记录回放不会重新调用模型、访问网络或写入资产。</p></div></header><OperationFailureNotice error={error || model.error} fallback="运行记录暂时无法加载或更新，请重试。" />
    <DisclosureSection title="自动执行（仅在 App 打开时）"><p>休眠后最多补跑一次；资料变化会合并，自身写入不会再次触发同一流程。</p>{triggers.map((trigger) => <div key={trigger.id}>{{ startup: "启动时执行", resource: "资料变化时执行", interval: "定时执行" }[trigger.kind]} · {trigger.enabled ? "开启" : "停用"} <OperationFailureNotice error={trigger.error} fallback="自动执行未完成，请检查设置后重试。" /><Button onClick={() => act(async () => { await model.triggers.setEnabled(trigger.id, !trigger.enabled); setTriggers(await model.triggers.list()); })}>{trigger.enabled ? "停用" : "启用"}</Button></div>)}{detail?.run.status === "succeeded" ? <div className="extension-toolbar"><OptionPicker aria-label="自动执行方式" value={triggerKind} onValueChange={(value) => setTriggerKind(value as typeof triggerKind)} options={[{ value: "resource", label: "选中资料变化" }, { value: "interval", label: "按时间间隔" }, { value: "startup", label: "下次启动" }]} /><Input aria-label="执行间隔分钟" type="number" min={1} max={10080} value={minutes} onChange={(_, data) => setMinutes(data.value)} /><Button onClick={() => act(async () => { await model.triggers.add(detail.run.id, triggerKind, Number(minutes)); setTriggers(await model.triggers.list()); })}>按本次授权开启</Button></div> : <p>先选择一个已成功的手动运行。</p>}</DisclosureSection>
    <div className="workflow-run-layout"><nav aria-label="工作流运行">{runs.map((run) => <Button key={run.id} appearance={selected === run.id ? "secondary" : "subtle"} onClick={() => setSelected(run.id)}>{run.definition.title} · {labels[run.status]}<small>{new Date(run.createdAt).toLocaleString()}</small></Button>)}</nav>
    {detail ? <article><h2>{detail.run.definition.title}</h2><p>{labels[detail.run.status]} · {(detail.run.elapsedMs / 1000).toFixed(1)} 秒 · 预算占用约 {detail.run.tokens} / {detail.run.definition.budget.maxTokens} tokens</p>
      {detail.run.parentRunId ? <Button onClick={() => setSelected(detail.run.parentRunId)}>查看上次运行</Button> : null}
      {worksheetText ? <Button onClick={() => {
        const url = URL.createObjectURL(new Blob([worksheetText], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `${detail.run.definition.id}.md`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>导出阅读模板快照</Button> : null}
      <div className="extension-toolbar">{!["succeeded", "cancelled", "running"].includes(detail.run.status) ? <Button disabled={["succeeded", "cancelled", "running"].includes(detail.run.status)} onClick={() => act(() => model.runner.execute(detail.run.id, detail.run.status === "waiting_input" ? { response } : {}))}>继续</Button> : null}{detail.run.status === "running" ? <Button disabled={detail.run.status !== "running"} onClick={() => act(() => model.runner.stop(detail.run.id, "paused"))}>暂停</Button> : null}{!["succeeded", "cancelled"].includes(detail.run.status) ? <Button disabled={["succeeded", "cancelled"].includes(detail.run.status)} onClick={() => act(() => model.runner.stop(detail.run.id, "cancelled"))}>取消</Button> : null}<Menu><MenuTrigger disableButtonEnhancement><IconAction label="更多运行操作" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList><MenuItem icon={<PlayRegular />} disabled={["succeeded", "cancelled", "running"].includes(detail.run.status)} onClick={() => act(() => model.runner.execute(detail.run.id, { singleStep: true }))}>单步</MenuItem><MenuItem icon={<ArrowRedoRegular />} disabled={detail.run.status === "running" || detail.run.snapshotsCleared} onClick={() => act(async () => { const previous = detail.run; const next = await model.runner.create({ owner: previous.owner, digest: previous.digest, definition: previous.definition, input: previous.input, settings: previous.settings, grantId: previous.grantId, parentRunId: previous.id }); setSelected(next.id); await model.runner.execute(next.id); })}>重新调用（新运行，可能调用模型）</MenuItem><MenuItem icon={<DocumentEditRegular />} disabled={detail.run.status !== "succeeded" || !host.studio} onClick={() => act(async () => { await host.studio!.service.call("liteasy_extension_from_run", { id: detail.run.id, title: detail.run.definition.title }, { writable: true }); host.openStudio(); })}>提炼为草稿</MenuItem><MenuItem icon={<ArrowSyncRegular />} disabled={detail.run.status !== "succeeded" || detail.run.snapshotsCleared} onClick={() => act(async () => setRecomputed(await model.runner.recompute(detail.run.id)))}>固定条件重算纯节点</MenuItem><MenuItem icon={<ArrowExportRegular />} onClick={() => downloadExtensionJson("workflow-run.json", detail)}>导出记录</MenuItem><MenuItem icon={<DeleteRegular />} onClick={() => { if (window.confirm("清理此运行的正文快照？记录仍保留，但无法再基于这些快照重算。")) act(() => model.runner.clearSnapshots(detail.run.id)); }}>清理正文快照</MenuItem></MenuList></MenuPopover></Menu></div>
      {detail.run.status === "waiting_input" ? <Textarea aria-label="补充运行输入" value={response} onChange={(_, data) => setResponse(data.value)} /> : null}
      {recomputed?.runId === detail.run.id ? <p role="status">纯节点重算：{recomputed.checks.filter((item) => item.mode === "recomputed").length} 项 · {recomputed.checks.every((item) => item.matches) ? "输出摘要一致" : "输出存在差异"}；外部操作使用原回执。</p> : null}
      {detail.run.status === "waiting_input" && detail.run.error ? <p role="status">{detail.run.error}</p> : <OperationFailureNotice error={detail.run.error} fallback="本次运行未完成，可检查资料并继续或重新运行。" />}{detail.missing.length ? <p>缺少 {detail.missing.length} 项运行快照，无法完整回放。</p> : null}
      {detail.run.definition.nodes.map((node) => <DisclosureSection key={node.id} title={`${node.title} · ${labels[detail.run.nodes[node.id].status]} · ${detail.run.nodes[node.id].attempts} 次尝试`}><OperationFailureNotice error={detail.run.nodes[node.id].error} fallback="此步骤未完成，请检查输入或查看技术详情。" />{detail.run.nodes[node.id].operations.map((id) => <DisclosureSection key={id} title={`操作技术回执 · ${detail.receipts[id]?.status ?? "待核对"}`}><pre>{redactDiagnostic(JSON.stringify(detail.receipts[id], null, 2) ?? "")}</pre></DisclosureSection>)}{detail.nodes[node.id] !== undefined ? typeof detail.nodes[node.id] === "string" ? <RichTextBlock text={String(detail.nodes[node.id])} onOpenPath={host.openLink} /> : <DisclosureSection title="技术详情：结构化输出"><pre>{redactDiagnostic(JSON.stringify(detail.nodes[node.id], null, 2) ?? "")}</pre></DisclosureSection> : null}</DisclosureSection>)}
    </article> : <p>选择记录查看实际步骤和保存结果。</p>}</div>
  </section>;
}
