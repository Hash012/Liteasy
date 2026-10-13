import { OptionPicker } from "../../shared/ui/productPrimitives";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Spinner, Tooltip } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { CitationGraphCanvas } from "./CitationGraphCanvas";
import { citationKey, citationRecommendation, projectCitationGraph, type CitationDirection, type CitationEdge, type CitationNode, type CitationPaper, type CitationWork } from "./citationGraph";
import type { createCitationGraphClient } from "./citationGraphClient";
import type { RecommendationItem } from "../recommendations/recommendation.types";
import "./citationGraph.css";

type Props = { papers: CitationPaper[]; client: ReturnType<typeof createCitationGraphClient>; onClose: () => void;
  onOpenPaper?: (id: string) => void; onOpenRecommendation?: (item: RecommendationItem) => void;
  onRetrieveMetadata?: (id: string) => Promise<string>; initialPaperId?: string };
export default function CitationGraphDialog({ papers, client, onClose, onOpenPaper, onOpenRecommendation, onRetrieveMetadata, initialPaperId }: Props) {
  const [library, setLibrary] = useState<CitationWork[]>([]);
  const [expansion, setExpansion] = useState<{ works: CitationWork[]; edges: CitationEdge[] }>({ works: [], edges: [] });
  const [selected, setSelected] = useState<string>();
  const [direction, setDirection] = useState<CitationDirection>("both");
  const [topK, setTopK] = useState("10");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const task = useRef<AbortController>();
  const current = useRef({ papers, client }); current.current = { papers, client };
  // Bound the interactive graph; the searchable paper chooser lets larger libraries choose a working set.
  const [workingIds, setWorkingIds] = useState(() => papers.slice(0, 300).map((paper) => paper.id));
  const working = useMemo(() => papers.filter((paper) => workingIds.includes(paper.id)), [papers, workingIds]);
  const graph = useMemo(() => projectCitationGraph(working, [...library, ...expansion.works], expansion.edges), [working, library, expansion]);
  const focus = graph.nodes.find((node) => node.id === selected) ?? graph.nodes.find((node) => node.localIds.includes(initialPaperId ?? "")) ?? graph.nodes[0];
  const [seedTitle, setSeedTitle] = useState("");
  const matches = graph.nodes.filter((node) => `${node.title} ${node.work?.authors.join(" ") ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => () => task.current?.abort(), []);
  // A changed library may invalidate identities. In-flight old-library replies must not replace it.
  const identity = working.map((paper) => `${paper.id}:${citationKey(paper) ?? ""}`).join("|");
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current === identity) return;
    lastIdentity.current = identity; task.current?.abort(); setBusy(false); setLoaded(false); setLibrary([]); setExpansion({ works: [], edges: [] });
  }, [identity]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (task.current && !task.current.signal.aborted) return;
    const controller = new AbortController(); task.current = controller; setBusy(true); setMessage("");
    try { await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "引用查询失败，请重试。"); }
    finally { if (task.current === controller) { task.current = undefined; setBusy(false); } }
  };
  const load = () => void run(async (signal) => {
    const result = await client.loadLibrary(working, signal); signal.throwIfAborted();
    if (current.current.client !== client) return;
    const chosenPaper = working.find((paper) => focus?.localIds.includes(paper.id));
    const chosenWork = chosenPaper && result.works.find((work) => chosenPaper.doi ? work.doi === chosenPaper.doi : work.id === chosenPaper.openAlexId);
    if (chosenWork) setSelected(chosenWork.id);
    setLibrary(result.works); setExpansion({ works: [], edges: [] }); setLoaded(true);
    setMessage(`已匹配 ${result.works.length} 篇论文；${working.length - result.identified} 篇缺少 DOI 或 OpenAlex 标识。未收录或缺少引用数据不代表没有引用关系。${result.errors.join(" ")}`);
  });
  const expand = () => void run(async (signal) => {
    if (!focus?.work) return;
    const result = await client.expand(focus.work, library, direction, Number(topK), signal); signal.throwIfAborted();
    setExpansion({ works: result.works, edges: result.edges }); setSeedTitle(focus.title);
    setMessage(`发现 ${result.works.length} 篇库外论文，按总引用量降序选取 Top ${topK}。${result.limited ? "本次达到查询上限，排序只覆盖已查询记录。" : ""}${result.errors.length ? ` 部分查询失败：${result.errors.join(" ")}` : ""}`);
  });
  const open = (node: CitationNode) => {
    if (node.localIds.length) { onOpenPaper?.(node.localIds[0]); onClose(); }
    else if (node.work && onOpenRecommendation) { onOpenRecommendation(citationRecommendation(node.work, seedTitle)); onClose(); }
  };
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className="citation-graph-dialog"><DialogBody>
      <DialogTitle action={<Tooltip content="关闭文献引用图" relationship="label"><Button appearance="subtle" icon={<DismissRegular />} aria-label="关闭文献引用图" onClick={onClose} /></Tooltip>}>文献引用图</DialogTitle>
      <DialogContent className="citation-graph-content">
        <div className="citation-graph-toolbar">
          <Button onClick={load} disabled={busy || !working.some(citationKey)}>{loaded ? "重新加载关系" : "加载引用关系"}</Button>
          <label>向外探索<OptionPicker aria-label="引用方向" value={String(direction ?? "")} onValueChange={nextValue => setDirection(nextValue as CitationDirection)} options={[{ value: String("both"), label: String("\u53C2\u8003\u4E0E\u88AB\u5F15\u8BBA\u6587") }, { value: String("references"), label: String("\u672C\u6587\u7684\u53C2\u8003\u6587\u732E") }, { value: String("citations"), label: String("\u5F15\u7528\u672C\u6587\u7684\u8BBA\u6587") }]} /></label>
          <label>引用量 Top K<OptionPicker aria-label="引用量 Top K" value={String(topK ?? "")} onValueChange={nextValue => setTopK(nextValue)} options={[...([5, 10, 20, 50].map((k) => ({ value: String(k), label: String(k) })))]} /></label>
          <Button appearance="primary" disabled={busy || !focus?.work || !focus.localIds.length} onClick={expand}>向外搜索一圈</Button>
          {busy ? <><Spinner size="tiny" label="正在查询" /><Button onClick={() => { task.current?.abort(); task.current = undefined; setBusy(false); setMessage("已取消查询，保留现有关系图。"); }}>取消</Button></> : null}
        </div>
        <div className="citation-graph-legend"><span className="local">● 库内论文</span><span className="discovered">○ 新发现论文</span><span>箭头：引用方 → 被引用方 · {graph.nodes.length} 个节点 · {graph.edges.length} 条引用</span>
          {expansion.works.length ? <Button size="small" appearance="subtle" onClick={() => setExpansion({ works: [], edges: [] })}>收起发现结果</Button> : null}</div>
        <p className="citation-graph-hint">加载时仅向 OpenAlex 查询论文标识，不发送正文、笔记或批注。选择节点查看详情，双击打开论文；拖动节点或缩放可整理布局。</p>
        <div className="citation-graph-workspace">
          <aside className="citation-graph-list"><Input aria-label="在引用图中查找论文" placeholder="查找论文或作者" value={query} onChange={(_, data) => setQuery(data.value)} />
            {papers.length > 300 ? <Button onClick={() => { setWorkingIds(papers.filter((paper) => paper.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 300).map((paper) => paper.id)); }}>使用匹配的前 300 篇作为工作集</Button> : null}
            <div role="list" aria-label="引用图论文列表">{matches.map((node) => <Button appearance={focus?.id === node.id ? "secondary" : "subtle"} key={node.id} title={node.title} onClick={() => setSelected(node.id)} onDoubleClick={() => open(node)}>
              <span>{node.title}<small>{node.localIds.length ? "库内" : "新发现"}{node.work ? ` · ${node.work.year ?? "年份未知"} · 引用 ${node.work.citationCount}` : " · 尚未匹配"}</small></span>
            </Button>)}{!matches.length ? <p>没有匹配的论文。</p> : null}</div>
          </aside>
          <div className="citation-graph-canvas"><CitationGraphCanvas graph={graph} selected={focus?.id} onSelect={setSelected} onOpen={open} /></div>
          <aside className="citation-graph-details" aria-label="引用论文信息">{focus ? <>
            <strong>{focus.title}</strong><p>{focus.work?.authors.join("、")}</p>
            {focus.work ? <><p>{focus.work.year ?? "年份未知"} · 被引用 {focus.work.citationCount} 次</p><p>{focus.work.doi ?? focus.work.id}</p></> : <p>先加载引用关系。缺少正式标识时，请获取或编辑这篇论文的元信息。</p>}
            <Button onClick={() => open(focus)} disabled={focus.localIds.length ? !onOpenPaper : !onOpenRecommendation}>{focus.localIds.length ? "打开库内论文" : "查看论文与下载"}</Button>
            {focus.localIds.length && onRetrieveMetadata ? <Button disabled={busy} onClick={() => void run(async (signal) => { const text = await onRetrieveMetadata(focus.localIds[0]); signal.throwIfAborted(); setMessage(text); })}>获取元信息</Button> : null}
            <p>引用关系来自 OpenAlex 的记录；没有连线可能是尚未收录，引用量也不等于研究相关度。</p>
          </> : <p>导入论文后可在这里探索引用关系。</p>}</aside>
        </div>
        <div role="status" className="citation-graph-status">{message || (papers.length > 300 ? "当前显示前 300 篇；可搜索并切换工作集。" : "选择一篇库内论文，加载关系后可向外探索。")}</div>
      </DialogContent>
    </DialogBody></DialogSurface>
  </Dialog>;
}
