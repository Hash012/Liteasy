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
  const assets = useContext(VisualAssetContext), [text, setText] = useState(""), [revision, setRevision] = useState<string>(), [message, setMessage] = useState("");
  const [writable, setWritable] = useState(false), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; const draft = editorDrafts.get(path); setText(draft?.text ?? ""); setRevision(draft?.revision); setWritable(false); setMessage(draft ? "未保存草稿已恢复；读取源文后检查版本再保存。" : ""); setBusy(false); return () => { generation.current++; }; }, [assets, path]);
  return <section><div className="extension-toolbar"><Button disabled={!assets || busy} onClick={() => { setBusy(true); const current = generation.current; void assets!.read(path, { maxCharacters: 80000 }).then((result) => { if (current !== generation.current) return; const draft = editorDrafts.get(path); setText(draft?.text ?? result.text); setRevision(draft?.revision ?? result.asset.revision); const conflict = draft && draft.revision !== result.asset.revision; setWritable(!conflict && !result.truncated && result.asset.capabilities.includes("write")); setMessage(conflict ? "源文已变化，草稿已保留，请在原编辑器合并后重新载入。" : result.truncated ? "这里只读取了部分内容，请在原编辑器编辑。" : "已读取"); }).catch((e) => { if (current === generation.current) setMessage(String(e)); }).finally(() => { if (current === generation.current) setBusy(false); }); }}>读取笔记</Button><Button disabled={!assets || !revision || !writable || busy} onClick={() => { setBusy(true); const current = generation.current; void assets!.write(path, { text, expectedRevision: revision!, mode: "replace" }).then((result) => { editorDrafts.remove(path); if (current !== generation.current) return; setRevision(result.asset.revision); setMessage(`已保存：+${result.addedLines} −${result.removedLines} 行`); }).catch((e) => { if (current === generation.current) setMessage(`${String(e)}；编辑草稿仍保留在此处。`); }).finally(() => { if (current === generation.current) setBusy(false); }); }}>保存修改</Button></div><Textarea aria-label="扩展中的 Markdown 笔记" value={text} readOnly={!writable || busy} resize="vertical" onChange={(_, data) => { setText(data.value); try { rememberDraft(path, data.value, revision); } catch (error) { setMessage(String(error)); } }} /><details><summary>预览</summary><RichTextBlock text={text} /></details><p role="status">{message}</p></section>;
}
