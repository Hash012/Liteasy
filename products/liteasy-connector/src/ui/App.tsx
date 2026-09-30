import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Checkbox, Field, Input, MessageBar, MessageBarBody, Spinner, Tooltip } from "@fluentui/react-components";
import { ArrowDownload20Regular, ArrowSync20Regular, Save20Regular, Search20Regular, Delete20Regular, Open20Regular, Document20Regular, Library20Regular } from "@fluentui/react-icons";
import type { PageInfo, SavedItem } from "../shared/types";
import { rpc } from "../shared/rpc";
import { getFile } from "../shared/library";
import { fileName, webUrl } from "../shared/references";
import { Navigation } from "./Navigation";
import { download, exportLibrary } from "./exportLibrary";

const labels: Record<string, string> = { journalArticle: "期刊论文", conferencePaper: "会议论文", book: "图书", webpage: "网页", document: "文档", preprint: "预印本", thesis: "学位论文" };
const tagsFrom = (value: string) => [...new Set(value.split(/[,，]/).map(s => s.trim()).filter(Boolean))];

export function App({ popup = false }: { popup?: boolean }) {
  const [page, setPage] = useState<PageInfo>();
  const [pageError, setPageError] = useState("");
  const [items, setItems] = useState<SavedItem[]>([]);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [collection, setCollection] = useState("");
  const [tags, setTags] = useState("");
  const [snapshot, setSnapshot] = useState(true);
  const [attachments, setAttachments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pageRequest = useRef(0);
  const currentTabId = useRef<number>();
  const refresh = useCallback(async () => setItems(await rpc<SavedItem[]>("LITEASY_LIST")), []);
  const updatePage = useCallback(async (tabId?: number) => {
    const serial = ++pageRequest.current;
    try {
      const target = tabId ?? (Number(new URLSearchParams(location.search).get("tabId")) || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
      if (target == null) throw new Error("打开一个网页，开始采集文献。");
      const next = await rpc<PageInfo>("LITEASY_PAGE_INFO", { tabId: target });
      if (serial !== pageRequest.current) return;
      setPage(next); setPageError("");
      currentTabId.current = target;
      const key = `liteasy:job:${target}`;
      const job = (await chrome.storage.session.get(key))[key];
      if (job?.status === "saving") setNotice("此页面正在保存，完成后会出现在文献库。");
      if (job?.status === "error") setError(job.error);
    } catch (e) { if (serial === pageRequest.current) { setPage(undefined); setPageError(String((e as Error).message)); } }
  }, []);
  useEffect(() => {
    void updatePage(); void refresh().catch(e => setError(e.message));
    const changed = (m: { type: string; tabId?: number }) => {
      if (m.type === "LITEASY_LIBRARY_CHANGED") void refresh();
      if (m.type === "LITEASY_PAGE_CHANGED" && m.tabId === currentTabId.current) void updatePage(m.tabId);
    };
    const jobChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "session") return;
      const job = changes[`liteasy:job:${currentTabId.current}`]?.newValue;
      if (job?.status === "saved") { setNotice(`已保存 ${job.count} 条文献。${job.warnings?.length ? "部分附件未保存，请查看文献详情。" : ""}`); void refresh(); }
      if (job?.status === "error") setError(job.error);
    };
    const activated = (info: { tabId: number }) => { void chrome.tabs.get(info.tabId).then(tab => {
      if (webUrl(tab.url)) void updatePage(info.tabId);
    }).catch(() => {}); };
    const updated = (id: number, changes: { status?: string }) => {
      if (changes.status === "complete") void chrome.tabs.get(id).then(tab => { if (tab.active && webUrl(tab.url)) void updatePage(id); }).catch(() => {});
    };
    chrome.runtime.onMessage.addListener(changed);
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.storage.onChanged.addListener(jobChanged);
    return () => { chrome.runtime.onMessage.removeListener(changed); chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated); chrome.storage.onChanged.removeListener(jobChanged); };
  }, [refresh, updatePage]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    if (!page) return;
    const result = await rpc<SavedItem[]>("LITEASY_CAPTURE", { options: { tabId: page.tabId, snapshot, attachments, collection, tags: tagsFrom(tags) } });
    setNotice(`已保存 ${result.length} 条文献。${result.some(r => r.warnings.length) ? "部分附件未保存，请查看文献详情。" : ""}`);
    await refresh(); setSelected(result[0]?.id || "");
  });
  const openWorkspace = (mode?: string) => {
    const path = mode ? `sidebar.html?mode=${mode}&tabId=${page?.tabId || ""}` : `panel.html?tabId=${page?.tabId || ""}`;
    // Must invoke sidePanel.open in this gesture, before waiting on other APIs.
    if (page?.tabId) {
      const opening = chrome.sidePanel.open({ tabId: page.tabId });
      void chrome.sidePanel.setOptions({ path, enabled: true });
      void opening.then(() => window.close()).catch(() => chrome.tabs.create({ url: chrome.runtime.getURL(path) }));
    } else void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  };
  const visible = items.filter(i => (!filter || i.collection === filter) && `${i.item.title} ${i.item.DOI || ""} ${i.tags.join(" ")} ${i.item.creators.map(c => c.name || `${c.firstName || ""} ${c.lastName || ""}`).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const current = items.find(i => i.id === selected);
  const collections = [...new Set(items.map(i => i.collection))].sort();
  return <div className={popup ? "connector-app popup-app" : "connector-app"}>
    {!popup && <Navigation tabId={page?.tabId} />}
    <main className="connector-main">
      <header className="connector-header"><div className="brand"><img src="liteasy.svg" alt="" /><div><strong>Liteasy <span>Connector</span></strong><p>收集文献，留下理解</p></div></div>
        <Tooltip content="刷新当前页面信息" relationship="label"><Button appearance="subtle" icon={<ArrowSync20Regular />} aria-label="刷新当前页面信息" onClick={() => void updatePage()} /></Tooltip>
      </header>
      <section className="capture-pane" aria-label="采集当前页面">
        <div className="section-caption"><span>当前页面</span><Badge appearance="tint">{page?.isPDF ? "PDF" : page?.translators[0]?.itemType === "multiple" ? "多条文献" : "网页"}</Badge></div>
        <h1>{page?.title || "从一个好问题开始"}</h1>
        <p className="page-url">{page ? new URL(page.url).hostname : pageError || "正在读取当前页面…"}</p>
        {page?.translators.length ? <p className="detected">已识别 · {page.translators[0].label}</p> : null}
        <div className="capture-fields"><Field label="保存到分类"><Input aria-label="保存到分类" placeholder="未分类" value={collection} maxLength={100} list="collections" onChange={(_, d) => setCollection(d.value)} /></Field>
          <datalist id="collections">{collections.map(c => <option key={c} value={c} />)}</datalist>
          <Field label="标签"><Input aria-label="文献标签" placeholder="用逗号分隔" value={tags} onChange={(_, d) => setTags(d.value)} /></Field></div>
        <div className="capture-options"><Checkbox label="网页快照" checked={snapshot} onChange={(_, d) => setSnapshot(d.checked === true)} /><Checkbox label="PDF / EPUB 附件" checked={attachments} onChange={(_, d) => setAttachments(d.checked === true)} /></div>
        <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Save20Regular />} disabled={!page || busy} onClick={save} className="save-page">{busy ? "正在处理…" : "保存到 Liteasy"}</Button>
        <p className="capture-hint">文献与附件保存在 Liteasy 浏览器文献库</p>
      </section>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {notice && <MessageBar intent="info"><MessageBarBody>{notice}</MessageBarBody></MessageBar>}
      {popup ? <div className="popup-links"><Button icon={<Library20Regular />} onClick={() => openWorkspace()}>文献库</Button><Button onClick={() => openWorkspace("notes")}>阅读批注</Button><Button onClick={() => openWorkspace("whiteboard")}>知识白板</Button></div> : <>
        <section className="library-toolbar" aria-label="文献库工具"><div className="section-caption"><strong>我的文献库</strong><span>{visible.length} 条</span></div>
          <Input contentBefore={<Search20Regular />} placeholder="搜索标题、作者、DOI、标签" aria-label="搜索文献" value={search} onChange={(_, d) => setSearch(d.value)} />
          <select aria-label="筛选分类" value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部分类</option>{collections.map(c => <option key={c}>{c}</option>)}</select>
          <div className="export-actions">{(["zip", "bib", "ris", "json"] as const).map(format => <Button key={format} size="small" disabled={busy || !visible.length} icon={format === "zip" ? <ArrowDownload20Regular /> : undefined} onClick={() => run(async () => {
            await exportLibrary(visible, format); setNotice(`已导出 ${visible.length} 条文献${format === "zip" ? "及其附件" : "的元数据"}。`);
          })}>{format === "zip" ? "完整归档" : format === "bib" ? "BibTeX" : format.toUpperCase()}</Button>)}</div>
        </section>
        <div className="library-workspace"><section className="reference-list" aria-label="文献列表">
          {!visible.length && <div className="library-empty"><Library20Regular /><h2>把值得再读的内容留下来</h2><p>在论文页面点击保存。快照和附件可随文献一起导出。</p></div>}
          {visible.map(item => <button key={item.id} className={`reference-row ${selected === item.id ? "selected" : ""}`} onClick={() => setSelected(item.id)}>
            <Document20Regular /><span><strong>{item.item.title}</strong><small>{labels[item.item.itemType] || "文献"} · {item.collection} · {item.attachments.length} 个附件</small>{!!item.warnings.length && <small className="warning-label">部分附件未保存</small>}</span>
          </button>)}
        </section>
        {current && <section className="reference-detail" aria-label="文献详情"><h2>{current.item.title}</h2><p>{current.item.creators.map(c => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).join("；")}</p>
          <p className="muted">{[current.item.publicationTitle, current.item.date].filter(Boolean).join(" · ")}</p>
          {current.item.DOI && <p>DOI: {current.item.DOI}</p>}
          <div className="detail-actions"><Button size="small" icon={<Open20Regular />} onClick={() => void chrome.tabs.create({ url: current.item.url })}>原文</Button>
          <Button size="small" icon={<Delete20Regular />} onClick={() => { if (confirm(`删除“${current.item.title}”及其本地附件？`)) void run(async () => { await rpc("LITEASY_REMOVE", { id: current.id }); setSelected(""); await refresh(); }); }}>删除</Button></div>
          <MetadataEditor key={`${current.id}:${current.updatedAt}`} item={current} save={(c, t) => run(async () => { await rpc("LITEASY_EDIT", { id: current.id, collection: c, tags: tagsFrom(t) }); await refresh(); setNotice("分类与标签已保存。"); })} />
          {current.item.abstractNote && <details><summary>摘要</summary><p>{current.item.abstractNote}</p></details>}
          <h3>已保存附件</h3>{!current.attachments.length && <p className="muted">此条目仅保存了文献信息。</p>}
          {current.attachments.map(file => <Button key={file.id} appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => run(async () => {
            const stored = await getFile(file.id); if (!stored) throw new Error("附件不存在。");
            const ext = file.mimeType === "text/html" ? "html" : file.mimeType === "application/pdf" ? "pdf" : "epub";
            download(stored.blob, `${fileName(current.item.title)}.${ext}`);
          })}>{file.title} · {(file.size / 1024).toFixed(0)} KB</Button>)}
          {current.warnings.map((warning, i) => <p key={i} className="warning-label">{warning}</p>)}
          <p className="detail-footnote">{current.translator} · {new Date(current.updatedAt).toLocaleString()}</p>
        </section>}</div>
      </>}
      <footer className="connector-footer">保存在此浏览器 · 阅读批注与白板可单独备份</footer>
    </main>
  </div>;
}

function MetadataEditor({ item, save }: { item: SavedItem; save: (collection: string, tags: string) => Promise<void> }) {
  const [collection, setCollection] = useState(item.collection);
  const [tags, setTags] = useState(item.tags.join(", "));
  return <div className="detail-fields"><Field label="分类"><Input value={collection} maxLength={100} onChange={(_, d) => setCollection(d.value)} /></Field><Field label="标签"><Input value={tags} onChange={(_, d) => setTags(d.value)} /></Field><Button size="small" onClick={() => void save(collection, tags)}>保存分类与标签</Button></div>;
}
