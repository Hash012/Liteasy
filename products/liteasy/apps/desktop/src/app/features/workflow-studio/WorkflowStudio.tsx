import { ActionButton as Button, DisclosureSection, InfoPopover, OptionPicker, IconAction } from "../../shared/ui/productPrimitives";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Field, FluentProvider, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tab, TabList, Textarea, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { AddRegular, PlayRegular, SaveRegular, MoreHorizontalRegular, ArrowImportRegular, HistoryRegular, ArrowExportRegular, ArrowUploadRegular } from "@fluentui/react-icons";
import { useExtensionWorkbench } from "../extensions/extensionWorkbenchContext";
import { downloadExtensionJson } from "../extensions/ExtensionViews";
import { paperLensPackage } from "../extensions/paperLensPackage";
import { buildExtensionPackage, validateExtensionPackage, type BoardTemplate, type ValidatedExtension } from "../extensions/extensionPackage";
import type { ExtensionDraft, DraftChange, TrialReport } from "./extensionDraftStore";
import { ExtensionDraftHistory } from "./ExtensionDraftHistory";
import { StudioGraph } from "./StudioGraph";
import { StudioCardPreview } from "./StudioCardPreview";
import type { WorkflowDefinition } from "../workflows/workflowDefinition";
import { operationCatalog, operationIds, operationLabels, type OperationId } from "../workflows/operationCatalog";
import { createBlockRegistry, blockRegistryCapabilities, type DerivedBlockDefinition } from "../visual-blocks/blockRegistry";
import { ComponentTreeView } from "../visual-blocks/ComponentTreeView";
import { VisualPreviewContext } from "../visual-blocks/visualPreviewContext";
import { SchemaFields } from "../extensions/SchemaFields";
import { parseDataSchema, schemaDefaults, type JsonObject } from "../extensions/extensionSchema";
import { WorkflowBindingEditor } from "./WorkflowBindingEditor";
import { editStudioFiles, parseStudioFile, studioBlocks, studioSourceError, studioTabForPath, travelStudioHistory, type StudioEditState, type StudioFiles } from "./studioEditing";
import { studioTutorialFiles, studioTutorialPath, readStudioTutorial } from "./studioTutorial";
import "./workflowStudio.css";

function PreviewTheme({ mode, children }: { mode: string; children: ReactNode }) {
  return mode === "inherit" ? <>{children}</> : <FluentProvider theme={mode === "dark" ? webDarkTheme : webLightTheme}>{children}</FluentProvider>;
}
export function WorkflowStudio() {
  const host = useExtensionWorkbench(), model = host?.studio;
  const [drafts, setDrafts] = useState<ExtensionDraft[]>([]), [draft, setDraft] = useState<ExtensionDraft>();
  const [edit, setEdit] = useState<StudioEditState>({ files: {}, past: [], future: [] });
  const [tab, setTab] = useState("composition"), [path, setPath] = useState("liteasy.extension.json");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [preview, setPreview] = useState<ValidatedExtension>(), [report, setReport] = useState<TrialReport>();
  const [selectedNode, setSelectedNode] = useState(""), [operator, setOperator] = useState<OperationId>("core.value");
  const [previewMode, setPreviewMode] = useState("inherit"), [narrow, setNarrow] = useState(false), [panel, setPanel] = useState("canvas");
  const [request, setRequest] = useState(""), [proposal, setProposal] = useState<{ revision: string; changes: DraftChange[] }>();
  const importFile = useRef<HTMLInputElement>(null), abort = useRef<AbortController>();
  const lastValid = useRef<Record<string, unknown>>({});
  const files = edit.files, text = files[path] ?? "";
  const dirty = !!draft && JSON.stringify(files) !== JSON.stringify(draft.files);
  useEffect(() => {
    if (!model) return;
    let alive = true;
    const reload = () => void model.drafts.list().then((items) => { if (alive) setDrafts(items); });
    reload(); const dispose = model.drafts.subscribe(reload);
    return () => { alive = false; dispose(); abort.current?.abort(); };
  }, [model]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  if (!host || !model) return <p>正在加载制作工作台…</p>;
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  function choose(value: ExtensionDraft) {
    setDraft(value); setEdit({ files: value.files, past: [], future: [] }); lastValid.current = {};
    const next = Object.keys(value.files).find((file) => file.startsWith("templates/")) ?? "liteasy.extension.json";
    setPath(next); setTab(studioTabForPath(next)); setSelectedNode(""); setProposal(undefined); setPreview(undefined); setReport(undefined);
  }
  function changeFiles(next: StudioFiles) { setEdit((current) => editStudioFiles(current, next)); setPreview(undefined); setReport(undefined); }
  function updateText(next: string) {
    const changed = { ...files, [path]: next };
    if (path !== studioTutorialPath && readStudioTutorial(changed)) { const tutorial = readStudioTutorial(changed)!; changed[studioTutorialPath] = JSON.stringify({ ...tutorial, edited: tutorial.edited || path.startsWith("templates/"), previewed: false, saved: false }); }
    changeFiles(changed);
  }
  function updateJson(value: unknown) {
    const next = { ...files, [path]: JSON.stringify(value, null, 2) };
    if (readStudioTutorial(next)) { const tutorial = readStudioTutorial(next)!; next[studioTutorialPath] = JSON.stringify({ ...tutorial, edited: true, previewed: false, saved: false }); }
    changeFiles(next);
  }
  function switchTab(next: string) {
    setTab(next);
    if (next !== "source" && next !== "api" && studioTabForPath(path) !== next) setPath(Object.keys(files).find((file) => studioTabForPath(file) === next) ?? "");
    setSelectedNode("");
  }
  let document: Record<string, unknown> | undefined, sourceError = "";
  if (text && path.endsWith(".json")) {
    try { const value = parseStudioFile(path, text); lastValid.current[path] = value; document = value as Record<string, unknown>; }
    catch (e) { sourceError = studioSourceError(path, text, e); document = lastValid.current[path] as Record<string, unknown> | undefined; }
  }
  const workflow = document?.schema === "liteasy.workflow/v2" ? document as unknown as WorkflowDefinition : undefined;
  const composition = document?.schema === "liteasy.board-template/v1" ? document as unknown as BoardTemplate : undefined;
  let blocks: DerivedBlockDefinition[] = [], blockError = "";
  try { blocks = studioBlocks(files); } catch (e) { blockError = `类型文件无效：${String(e)}`; }
  const selectedCard = composition?.cards.find((card) => card.id === selectedNode);
  const tutorial = readStudioTutorial(files);
  const paths = Object.keys(files).filter((file) => tab === "source" || studioTabForPath(file) === tab);
  async function save() {
    const next = { ...files };
    if (tutorial?.edited && tutorial.previewed) next[studioTutorialPath] = JSON.stringify({ ...tutorial, saved: true });
    const changes = Object.entries(next).filter(([file, value]) => value !== draft!.files[file]).map(([path, text]) => ({ path, text }));
    const saved = await model!.drafts.patch(draft!.id, draft!.revision, changes, "user");
    setDraft(saved); setEdit((current) => ({ ...current, files: saved.files }));
  }
  async function validate() {
    const validated = await validateExtensionPackage(await buildExtensionPackage(files));
    setPreview(validated);
    if (tutorial?.edited) setEdit((current) => ({ ...current, files: { ...current.files, [studioTutorialPath]: JSON.stringify({ ...tutorial, previewed: true, saved: false }) } }));
  }
  const previewThemeControl = <OptionPicker aria-label="预览主题" value={previewMode} onValueChange={setPreviewMode} options={[{ value: "inherit", label: "跟随应用主题" }, { value: "light", label: "强制浅色预览" }, { value: "dark", label: "强制深色预览" }]} />;
  const tutorialContent = <><p>演示数据：认识四张卡片 → 修改正文 → 对比预览 → 保存草稿。示例与真实论文独立，不需要登录或模型连接。</p><Button disabled={dirty || busy} onClick={() => void run(async () => choose(await model.drafts.create("离线演示：四张研究卡片", await studioTutorialFiles(), "离线教学示例 v1；不含真实证据。")))}>开始离线演示</Button>{tutorial ? <p>{tutorial.edited ? "已修改" : "待修改"} · {tutorial.previewed ? "已预览" : "待预览"} · {tutorial.saved ? "已保存" : "待保存"}</p> : null}</>;
  return <section className="extension-page workflow-studio">
    <header className="studio-header"><div><h1>{draft?.title ?? "制作工作台"}</h1>{draft ? <span role="status">{busy ? "正在处理…" : dirty ? "未保存" : "草稿已保存"}</span> : null}</div><div className="extension-toolbar">
      {draft ? <><Button icon={<SaveRegular />} disabled={!dirty || busy} onClick={() => void run(save)}>保存草稿</Button><Button appearance="primary" disabled={busy || !!sourceError} onClick={() => void run(validate)}>校验与预览</Button><Button icon={<PlayRegular />} disabled={dirty || busy} onClick={() => void run(async () => setReport(await model.service.call("liteasy_extension_trial", { id: draft.id }, { writable: true }) as TrialReport))}>隔离样例试跑</Button></> : null}
      <OptionPicker aria-label="选择扩展草稿" value={draft?.id ?? ""} disabled={dirty || busy} onValueChange={(value) => { if (value) void run(async () => choose(await model.drafts.get(value))); }} options={[{ value: "", label: "选择草稿", disabled: true }, ...drafts.map((item) => ({ value: item.id, label: item.title }))]} />
      <Menu><MenuTrigger disableButtonEnhancement><IconAction label="更多制作操作" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList>
        <MenuItem icon={<ArrowImportRegular />} disabled={dirty || busy} onClick={() => importFile.current?.click()}>导入项目</MenuItem><MenuItem icon={<HistoryRegular />} onClick={() => host.openRuns()}>运行记录</MenuItem>
        <MenuItem icon={<AddRegular />} disabled={busy || dirty} onClick={() => void run(async () => { const files = { ...(await paperLensPackage()).files }; const manifest = JSON.parse(files["liteasy.extension.json"]); const original = manifest.id; manifest.id = `plugin.personal-${crypto.randomUUID().slice(0, 8)}`; manifest.name = "我的论文比较台"; manifest.version = "1.0.0"; for (const file of Object.keys(files)) files[file] = files[file].split(original).join(manifest.id); files["liteasy.extension.json"] = JSON.stringify(manifest, null, 2); choose(await model.drafts.create(manifest.name, files)); })}>从论文比较模板开始</MenuItem>
        {draft ? <><MenuItem icon={<ArrowUploadRegular />} disabled={dirty || busy || !report?.passed} onClick={() => void run(async () => { const pkg = await model.drafts.publish(draft.id, host.packages.store); setError(`已发布 ${pkg.manifest.version}；请在扩展中检查新增入口并启用。`); })}>发布本地版本</MenuItem><MenuItem icon={<ArrowExportRegular />} disabled={dirty || busy} onClick={() => void run(async () => downloadExtensionJson(`${draft.title}.liteasy-extension.json`, await buildExtensionPackage(draft.files)))}>导出包</MenuItem></> : null}
      </MenuList></MenuPopover></Menu>
    </div></header>
    <input ref={importFile} hidden type="file" accept=".json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(async () => { if (file.size > 24 * 1024 * 1024) throw new Error("包文件过大。"); const pkg = await validateExtensionPackage(JSON.parse(await file.text())); choose(await model.drafts.create(pkg.manifest.name, pkg.bundle.files)); }); }} />
    {draft ? <div className="studio-mode-row">{tutorial ? <><Badge appearance="tint">离线示例</Badge><span>示例与真实论文独立，不含真实证据。</span></> : null}<InfoPopover label="制作工作台帮助">{tutorialContent}<p>画布可缩放；选择卡片可在属性区阅读完整正文。调整面板不会重置视角。</p></InfoPopover></div>
      : <DisclosureSection className="studio-tutorial" title="查看离线示例" defaultOpen>{tutorialContent}</DisclosureSection>}
    {draft ? <>
      <ExtensionDraftHistory store={model.drafts} draft={draft} disabled={dirty || busy} onRestore={choose} />
      <div className="studio-taskbar"><TabList selectedValue={tab} onTabSelect={(_, data) => switchTab(String(data.value))}><Tab value="composition">组合</Tab><Tab value="type">类型</Tab><Tab value="workflow">流程</Tab><Tab value="settings">设置</Tab><Tab value="source">源码</Tab><Tab value="api">API 目录</Tab></TabList><Button disabled={!edit.past.length || busy} onClick={() => { setEdit((current) => travelStudioHistory(current, "undo")); setPreview(undefined); setReport(undefined); }}>撤销</Button><Button disabled={!edit.future.length || busy} onClick={() => { setEdit((current) => travelStudioHistory(current, "redo")); setPreview(undefined); setReport(undefined); }}>重做</Button></div>
      {tab === "api" ? <div><p>共享基础能力：{blockRegistryCapabilities.join(" · ")}</p>{operationIds.map((id) => <DisclosureSection key={id} title={`${id} · ${operationCatalog[id].effect}`}><p>版本 {operationCatalog[id].version} · 重试 {operationCatalog[id].retry} · {operationCatalog[id].capability ?? "无额外权限"}</p></DisclosureSection>)}</div> : <>
        {paths.length > 1 || tab === "source" ? <OptionPicker aria-label="项目文件" value={path} onValueChange={(value) => { setPath(value); setSelectedNode(""); }} options={paths.map((file) => ({ value: file, label: file }))} /> : null}
        {sourceError ? <div role="alert"><p>{sourceError}</p><p>源码输入已保留；画布显示最后一个有效版本。请修复源码后继续可视化编辑。</p></div> : null}
        {blockError ? <p role="alert">{blockError}</p> : null}
        {(workflow || composition) && (tab === "workflow" || tab === "composition") ? <>
          <div className="studio-panel-switch"><Button aria-pressed={panel === "canvas"} onClick={() => setPanel("canvas")}>画布</Button><Button aria-pressed={panel === "properties"} onClick={() => setPanel("properties")}>属性</Button></div>
          <div className="studio-editor" data-panel={panel}>
            <div className="studio-canvas"><StudioGraph key={`${draft.id}:${path}`} value={workflow ?? composition!} blocks={blocks} readOnly={busy || !!sourceError} onSelect={(id) => { setSelectedNode(id); setPanel("properties"); }} onChange={updateJson} /></div>
            <fieldset disabled={busy || !!sourceError} className="studio-properties" onKeyDown={(event) => { if (event.key === "Delete" || event.key === "Backspace") event.stopPropagation(); }}>
              {composition ? <><div className="studio-card-list" aria-label="组合卡片">{composition.cards.map((card) => <Button key={card.id} aria-pressed={card.id === selectedNode} onClick={() => setSelectedNode(card.id)}>{card.title}</Button>)}</div><div className="extension-toolbar"><Button onClick={() => { const id = `card-${crypto.randomUUID().slice(0, 8)}`; updateJson({ ...composition, cards: [...composition.cards, { id, title: "新卡片", type: { id: "liteasy/RichTextBlock", version: "1.0.0" }, data: { text: "" }, position: { x: 20, y: 20 }, size: { width: 320, height: 320 } }] }); setSelectedNode(id); }}>添加卡片</Button><Button disabled={!selectedCard} onClick={() => { updateJson({ ...composition, cards: composition.cards.filter((card) => card.id !== selectedNode) }); setSelectedNode(""); }}>删除卡片</Button></div>
                {selectedCard ? <><Field label="卡片标题"><Input aria-label="卡片标题" value={selectedCard.title} onChange={(_, data) => updateJson({ ...composition, cards: composition.cards.map((card) => card.id === selectedNode ? { ...card, title: data.value } : card) })} /></Field>{(() => { try { const registry = createBlockRegistry(blocks), type = registry.resolve(selectedCard.type.id, selectedCard.type.version); const schema = { ...type.dataSchema, properties: { ...type.dataSchema.properties, text: { ...type.dataSchema.properties!.text, title: "卡片正文" } } }; return <SchemaFields key={`${path}:${selectedCard.id}`} schema={schema} value={{ ...type.defaults, ...selectedCard.data }} onChange={(data) => updateJson({ ...composition, cards: composition.cards.map((card) => card.id === selectedNode ? { ...card, data } : card) })} />; } catch { return <p>请在源码中修复此卡片的类型引用；原数据未丢失。</p>; } })()}<section aria-label="选中卡片预览"><StudioCardPreview card={selectedCard} blocks={blocks} /></section></> : <p>选择一张卡片，阅读或修改其内容。</p>}
              </> : workflow ? <><div className="studio-step-list">{workflow.nodes.map((node) => <Button key={node.id} appearance={selectedNode === node.id ? "secondary" : "subtle"} onClick={() => setSelectedNode(node.id)}>{node.title} · {operationLabels[node.operation.id]}</Button>)}</div><OptionPicker aria-label="添加的操作类型" value={operator} onValueChange={(value) => setOperator(value as OperationId)} options={operationIds.map((id) => ({ value: id, label: operationLabels[id] }))} /><Button onClick={() => { const id = `node-${crypto.randomUUID().slice(0, 8)}`; updateJson({ ...workflow, nodes: [...workflow.nodes, { id, title: "新步骤", operation: { id: operator, version: "1.0.0" }, input: {}, retries: 0, breakpoint: false }] }); setSelectedNode(id); }}>添加步骤</Button><Button disabled={!selectedNode} onClick={() => updateJson({ ...workflow, nodes: workflow.nodes.map((node) => node.id === selectedNode ? { ...node, breakpoint: !node.breakpoint } : node) })}>切换断点</Button><Button disabled={!selectedNode} onClick={() => updateJson({ ...workflow, nodes: workflow.nodes.filter((node) => node.id !== selectedNode), edges: workflow.edges.filter((edge) => edge.from !== selectedNode && edge.to !== selectedNode), layout: Object.fromEntries(Object.entries(workflow.layout).filter(([id]) => id !== selectedNode)) })}>移除步骤</Button><WorkflowBindingEditor workflow={workflow} selected={selectedNode} onChange={updateJson} /></> : null}
            </fieldset>
          </div>
        </> : null}
        {tab === "type" && document ? (() => { try { const registry = createBlockRegistry(blocks), item = document as unknown as DerivedBlockDefinition, type = registry.resolve(item.id, item.version); return <section className="studio-type-preview"><p>继承 {type.family}</p>{previewThemeControl}<fieldset disabled={busy || !!sourceError}><SchemaFields key={`${path}:${type.version}`} schema={type.dataSchema} value={type.defaults} onChange={(defaults) => updateJson({ ...document, defaults })} /></fieldset><PreviewTheme mode={previewMode}><VisualPreviewContext.Provider value={true}>{type.templates.map((tree, index) => <ComponentTreeView key={index} tree={tree} data={type.defaults} />)}</VisualPreviewContext.Provider></PreviewTheme></section>; } catch (e) { return <p role="status">无法预览此类型：{String(e)}。请检查源码。</p>; } })() : null}
        {tab === "settings" && document?.type === "object" ? (() => { try { const schema = parseDataSchema(document); return <fieldset disabled={busy || !!sourceError}><SchemaFields schema={schema} value={schemaDefaults(schema) as JsonObject} onChange={(value) => updateJson({ ...schema, properties: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, field]) => [key, { ...field, default: value[key] }])) })} /></fieldset>; } catch { return null; } })() : null}
        {tab === "source" ? <Field label="文件源码"><Textarea disabled={busy} className="studio-source" aria-label="扩展源文件" resize="vertical" value={text} onChange={(_, data) => updateText(data.value)} /></Field> : null}
        {!path && tab !== "api" ? <p>此项目尚无对应文件；可在源码中查看现有项目文件。</p> : null}
      </>}
      {preview ? <section className="studio-preview"><div className="extension-toolbar"><h2>实际组件预览</h2>{previewThemeControl}<Button onClick={() => setNarrow(!narrow)}>{narrow ? "正常宽度" : "窄栏"}</Button><Button onClick={() => setPreview(undefined)}>关闭预览</Button></div><PreviewTheme mode={previewMode}><div style={{ maxWidth: narrow ? 320 : undefined }}><p>{preview.manifest.name} · {preview.manifest.version}</p>{preview.templates.map((template) => <section key={template.id}><h3>{template.title}</h3>{template.cards.map((card) => <article key={card.id} className="extension-library-card"><h4>{card.title}</h4><StudioCardPreview card={card} blocks={preview.blocks} /></article>)}</section>)}</div></PreviewTheme></section> : null}
      {report ? <section><h2>样例报告 · {report.passed ? "通过" : "未通过"}</h2>{report.cases.map((item, i) => <p key={i}>{item.name} · {item.passed ? "通过" : item.error}</p>)}</section> : null}
      <DisclosureSection title="AI 制作助手"><Textarea aria-label="描述扩展需求" value={request} onChange={(_, data) => setRequest(data.value)} placeholder="描述输入、输出、保存位置，以及希望如何组织内容" /><Button disabled={busy || dirty || !request.trim()} onClick={() => void run(async () => { abort.current?.abort(); abort.current = new AbortController(); setProposal({ revision: draft.revision, changes: await model.propose(draft, request, abort.current.signal) }); })}>生成草稿变更</Button>{busy ? <Button onClick={() => abort.current?.abort()}>停止生成</Button> : null}{proposal ? <><h3>待应用变更</h3>{proposal.changes.map((change) => <DisclosureSection key={change.path} title={`${change.path} · ${change.text === null ? "删除" : draft.files[change.path] ? "修改" : "新增"}`}><div className="studio-diff"><pre>{draft.files[change.path] ?? ""}</pre><pre>{change.text ?? ""}</pre></div></DisclosureSection>)}<Button disabled={busy || dirty} onClick={() => void run(async () => { choose(await model.drafts.patch(draft.id, proposal.revision, proposal.changes, "ai")); setProposal(undefined); })}>应用到草稿</Button></> : null}</DisclosureSection>
    </> : null}{error ? <p role="status">{error}</p> : null}
  </section>;
}
