import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { useMarkdownAutosave } from "../markdown/useMarkdownAutosave";
import { ReferenceSourceContext } from "../resource-links/ResourceReferencesContext";
import { useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, Input, Tab, TabList, Textarea } from "@fluentui/react-components";
import { VisualAssetContext } from "./AssetImage";
import { RichTextBlock } from "./VisualBlockBase";
import type { JsonValue } from "../extensions/extensionSchema";
import type { AgentAsset } from "../resource-filesystem/agentAsset.types";
import type { ComponentTree } from "./blockRegistry";
import { parseVisualizationArtifact } from "../visualization/visualizationArtifact.schema";
import { VisualizationArtifactHost } from "../visualization/VisualizationArtifactHost";
import { visualEditorDrafts as editorDrafts } from "./visualEditorDrafts";

export function CompositePrimitive({ tree, read, children, openPath }: { tree: ComponentTree; read(key: string): JsonValue | undefined; children?: ReactNode[]; openPath?(path: string): Promise<void> }) {
  const [selected, setSelected] = useState(0), [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const text = (key: string) => String(read(key) ?? "");
  const markdown = (value: JsonValue) => <RichTextBlock text={typeof value === "string" ? value : JSON.stringify(value)} onOpenPath={openPath} />;
  if (tree.component === "Tabs") { const labels = read("labels"); return <div><TabList selectedValue={selected} onTabSelect={(_, data) => setSelected(Number(data.value))}>{(Array.isArray(labels) ? labels : []).map((label, index) => <Tab value={index} key={index}>{String(label)}</Tab>)}</TabList><div role="tabpanel">{children?.[selected]}</div></div>; }
  if (tree.component === "Dialog") return <><Button onClick={() => setOpen(true)}>{text("title")}</Button><Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>{text("title")}</DialogTitle><DialogContent>{children}</DialogContent><Button onClick={() => setOpen(false)}>关闭</Button></DialogBody></DialogSurface></Dialog></>;
  if (tree.component === "Visualization") { try { return <VisualizationArtifactHost artifact={parseVisualizationArtifact(read("artifact"))} />; } catch (error) { return <div role="status">图形数据未通过契约校验：{String(error)}</div>; } }
  if (tree.component === "MarkdownEditor") return <ResourceEditor path={text("path")} />;
  if (tree.component === "ResourcePicker") return <ResourcePicker openPath={openPath} />;
  const values = read("items"), items = Array.isArray(values) ? values : [];
  if (["CitationList", "Timeline", "TreeOutline", "Chart"].includes(tree.component)) return <section><h3>{text("title")}</h3><ol className={`visual-${tree.component.toLowerCase()}`}>{items.slice(page * 30, (page + 1) * 30).map((item, index) => <li key={index}>{markdown(item)}</li>)}</ol>{items.length > 30 ? <div className="extension-toolbar"><Button disabled={!page} onClick={() => setPage((value) => value - 1)}>上一页</Button><span>{page + 1} / {Math.ceil(items.length / 30)}</span><Button disabled={(page + 1) * 30 >= items.length} onClick={() => setPage((value) => value + 1)}>下一页</Button></div> : null}</section>;
  return <section role={tree.component === "Status" ? "status" : tree.component === "Toolbar" ? "toolbar" : undefined} className={`visual-component visual-component-${tree.component.toLowerCase()}`} style={tree.component === "Split" ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 } : undefined}>
    {text("title") ? <RichTextBlock text={`### ${text("title")}`} onOpenPath={openPath} /> : null}
    {text("text") ? <RichTextBlock text={text("text")} onOpenPath={openPath} /> : null}
    {tree.component === "EvidenceCard" && text("source") ? <RichTextBlock text={`[查看来源](${text("source")})`} onOpenPath={openPath} /> : null}{children}
  </section>;
}
function ResourcePicker({ openPath }: { openPath?(path: string): Promise<void> }) {
  const assets = useContext(VisualAssetContext), [query, setQuery] = useState(""), [items, setItems] = useState<AgentAsset[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setItems([]); setError(""); setBusy(false); return () => { generation.current++; }; }, [assets]);
  return <section><Input aria-label="查找引用资料" value={query} onChange={(_, data) => setQuery(data.value)} /><Button disabled={!assets || busy} onClick={() => { setBusy(true); const current = generation.current; void assets!.search({ query, limit: 50 }).then((items) => { if (current === generation.current) setItems(items); }).catch((e) => { if (current === generation.current) setError(String(e)); }).finally(() => { if (current === generation.current) setBusy(false); }); }}>查找资料</Button>{error ? <p role="status">{error}</p> : null}<ul>{items.map((item) => <li key={item.path}><Button disabled={!openPath} onClick={() => void openPath?.(item.path)}>{item.title}</Button></li>)}</ul></section>;
}
function rememberDraft(path: string, text: string, revision?: string) {
  if (revision) editorDrafts.save(path, { text, revision });
}
function ResourceEditor({ path }: { path: string }) {
  const assets = useContext(VisualAssetContext), preference = useMarkdownEditing();
  const [text, setText] = useState(""), [saved, setSaved] = useState(""), [revision, setRevision] = useState<string>(), [message, setMessage] = useState("");
  const [writable, setWritable] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), inFlight = useRef(false), latestText = useRef(text); latestText.current = text;
  useEffect(() => { generation.current++; const draft = editorDrafts.get(path); setText(draft?.text ?? ""); setSaved(""); setRevision(draft?.revision); setWritable(false); setError(""); setMessage(draft ? "未保存草稿已恢复；读取源文后检查版本再保存。" : ""); setBusy(false); return () => { generation.current++; }; }, [assets, path]);
  async function read() {
    if (!assets || inFlight.current) return;
    const current = generation.current; inFlight.current = true; setBusy(true);
    try {
      const result = await assets.read(path, { maxCharacters: 80000 });
      if (current !== generation.current) return;
      const draft = editorDrafts.get(path), conflict = draft && draft.revision !== result.asset.revision;
      setText(draft?.text ?? result.text); setSaved(result.text); setRevision(draft?.revision ?? result.asset.revision);
      setWritable(!conflict && !result.truncated && result.asset.capabilities.includes("write"));
      setError(conflict ? "源文已变化，草稿已保留，请在原编辑器合并后重新载入。" : "");
      setMessage(result.truncated ? "这里只读取了部分内容，请在原编辑器编辑。" : "已读取");
    } catch (e) { if (current === generation.current) setError(String(e)); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  }
  async function save() {
    if (!assets || !revision || !writable || inFlight.current) return;
    const current = generation.current, written = text;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await assets.write(path, { text: written, expectedRevision: revision, mode: "replace" });
      if (current !== generation.current) return;
      setRevision(result.asset.revision); setSaved(written);
      if (latestText.current === written) editorDrafts.remove(path);
      else rememberDraft(path, latestText.current, result.asset.revision);
      setMessage(`已保存：+${result.addedLines} −${result.removedLines} 行`);
    } catch (e) { if (current === generation.current) setError(`${String(e)}；编辑草稿仍保留在此处。`); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  }
  useMarkdownAutosave({ identity: path, value: text, saved, enabled: preference.mode === "live" && preference.autosave && writable, busy, blocked: Boolean(error), save });
  return <ReferenceSourceContext.Provider value={path}><section className="extension-markdown-editor">
    <div className="extension-toolbar"><Button disabled={!assets || busy} onClick={() => void read()}>读取笔记</Button><Button disabled={!assets || !revision || !writable || busy || text === saved} onClick={() => void save()}>保存修改</Button></div>
    <MarkdownEditor documentKey={path} label="扩展中的 Markdown 笔记" value={text} readOnly={!writable} onChange={(value) => { setText(value); try { rememberDraft(path, value, revision); } catch (e) { setError(String(e)); } }} />
    {preference.mode === "manual" ? <details><summary>预览</summary><RichTextBlock text={text} /></details> : null}
    <p role="status">{busy ? "正在保存或读取…" : error ? preference.mode === "live" ? "自动保存已暂停 · 草稿保留" : "未保存 · 草稿保留" : text !== saved && writable && preference.autosave && preference.mode === "live" ? "等待自动保存…" : message}</p>{error ? <p role="alert">{error}</p> : null}
  </section></ReferenceSourceContext.Provider>;
}
