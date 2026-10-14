import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { createPreviewRequest, previewErrorMessage } from "../resource-links/previewRequest";
import { contextKind, contextKindLabels, queryContextCatalog, type ContextCatalogQuery } from "./contextCatalogQuery";
import { mergeContextSelection } from "./contextSelectionManifest";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import { ContextAssetThumbnail } from "./ContextAssetThumbnail";
import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { ReferenceContentPicker } from "../resource-links/ReferenceContentPicker";
import type { ReferenceCandidate } from "../resource-links/resourceReferenceService";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Input, Tooltip
} from "@fluentui/react-components";
import { AddRegular, CopyRegular, DismissRegular, DocumentRegular, FolderRegular, SearchRegular } from "@fluentui/react-icons";
import type { AssistantComposerSuggestion, AssistantContextToken } from "./assistant.types";
import { getAssistantReadOnlyLabel } from "./assistantSuggestionIndex";
import type { ContextAssetPreview } from "./contextAssetPreview";
import "./contextAssetBrowser.css";

type ContextAssetBrowserProps = {
  suggestions: AssistantComposerSuggestion[];
  contextTokens?: AssistantContextToken[];
  initialQuery?: string;
  initialPreviewId?: string;
  onClose: () => void;
  onAddContextToken?: (token: AssistantContextToken) => void;
  onResolveContextToken?: (resolve: () => Promise<AssistantContextToken>) => void | Promise<boolean | void>;
  onChooseReference?: (candidate: ReferenceCandidate, fragment?: string) => void;
};

const PAGE_SIZE = 60;
const categoryOf = (asset: AssistantComposerSuggestion) => asset.category ?? "其他资产";
const available = (asset: AssistantComposerSuggestion) => !asset.unavailableReason && Boolean(asset.token || asset.resolveToken);

/** Uses the same catalog as @ mentions; visible images have bounded, read-only thumbnail loading. */
export function ContextAssetBrowser({ suggestions, contextTokens = [], initialQuery = "", initialPreviewId, onClose,
  onAddContextToken, onResolveContextToken, onChooseReference }: ContextAssetBrowserProps) {
  const { tChinese } = useUiTranslation();
  const references = useContext(ResourceReferencesContext);
  const [openContent, setOpenContent] = useState(Boolean(onChooseReference));
  const closeLabel = onChooseReference ? "返回编辑" : "返回对话";
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<string[]>([]);
  const [project, setProject] = useState<string[]>([]);
  const [domain, setDomain] = useState<"research" | "application">("research");
  const [groupBy, setGroupBy] = useState<ContextCatalogQuery["groupBy"]>("none");
  const [sort, setSort] = useState<ContextCatalogQuery["sort"]>("title");
  const [view, setView] = useState<"list" | "gallery">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const selectedAssets = useRef(new Map<string, AssistantComposerSuggestion>());
  const lastSelection = useRef<string>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState(initialPreviewId);
  const [onlySelected, setOnlySelected] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [noteText, setNoteText] = useState("");
  const [previewResult, setPreviewResult] = useState<{ asset: AssistantComposerSuggestion; value?: ContextAssetPreview; error?: string }>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(false);
  const referencePaths = useMemo(() => new Map((references?.suggestions ?? []).map((asset) => [asset.id, asset.resourcePath])), [references?.suggestions]);
  const catalog = useMemo(() => [...new Map(suggestions.filter((asset) => asset.trigger === "@" &&
    (asset.token || asset.resolveToken || asset.unavailableReason || onChooseReference && asset.resourcePath)).map((asset) => [asset.id,
      { ...asset, scopeId: asset.scopeId ?? references?.service.scope, resourcePath: asset.resourcePath ?? referencePaths.get(asset.id) }])).values()], [suggestions, referencePaths, references?.service.scope, onChooseReference]);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const snapshot = useMemo(() => queryContextCatalog(catalog, { query, domain, projects: project, kinds: category, groupBy, sort }), [catalog, query, domain, project, category, groupBy, sort]);
  const categories = [...new Set(catalog.map(contextKind))].map((kind) => [kind, snapshot.kindCounts.get(kind) ?? 0] as const);
  const projects = [...new Map(catalog.filter((asset) => asset.projectId).map((asset) => [asset.projectId!, { title: asset.projectTitle ?? "未命名项目", count: snapshot.projectCounts.get(asset.projectId!) ?? 0 }])).entries()];
  const scopeId = references?.service.scope ?? catalog.find((asset) => asset.scopeId)?.scopeId;
  const matches = onlySelected ? [...selected].map((id) => catalog.find((asset) => asset.id === id) ?? { ...selectedAssets.current.get(id)!, unavailableReason: tChinese("contextCatalog.unavailable", "资产已不可用，请重新选择。") }).filter((asset) => asset.id && (!scopeId || !asset.scopeId || asset.scopeId === scopeId)) : snapshot.matches;
  const visible = matches.slice(0, limit);
  const visibleIds = new Set(visible.map((asset) => asset.id));
  const groups = onlySelected ? [{ id: "selected", title: "", items: matches, selectableIds: [] }] : snapshot.groups;
  const selectionOrder = groups.filter((group) => !collapsed.has(group.id)).flatMap((group) => group.items).filter((asset) => visibleIds.has(asset.id));
  const acceptedTokens = useRef<AssistantContextToken[]>([]);
  const restoredScope = useRef<string>();
  const restoringScope = useRef(false);
  useEffect(() => {
    if (!scopeId || restoredScope.current === scopeId) return;
    const changedAccount = Boolean(restoredScope.current);
    restoredScope.current = scopeId; restoringScope.current = true;
    setQuery(initialQuery); setGroupBy("none"); setSort("title"); setCategory([]); setProject([]); setDomain("research");
    if (changedAccount) setPreviewId(undefined);
    setSelected(new Set()); selectedAssets.current.clear(); acceptedTokens.current = [];
    try {
      const saved = JSON.parse(localStorage.getItem(`liteasy:context-browser:${scopeId}`) ?? "null");
      if (saved) { if (!initialQuery) setQuery(typeof saved.query === "string" ? saved.query : ""); setGroupBy(["none", "project", "kind"].includes(saved.groupBy) ? saved.groupBy : "none"); setSort(saved.sort === "updated" ? "updated" : "title"); }
    } catch { /* Invalid or unavailable preferences do not prevent browsing. */ }
  }, [scopeId]);
  useEffect(() => {
    if (!scopeId || restoredScope.current !== scopeId) return;
    if (restoringScope.current) { restoringScope.current = false; return; }
    try { localStorage.setItem(`liteasy:context-browser:${scopeId}`, JSON.stringify({ query, groupBy, sort })); } catch { /* Storage may be unavailable. */ }
  }, [scopeId, query, groupBy, sort]);
  const preview = catalog.find((asset) => asset.id === previewId);
  const loadedPreview = previewResult?.asset === preview ? previewResult?.value : undefined;
  const previewError = previewResult?.asset === preview ? previewResult?.error : undefined;
  const previewLoading = Boolean(!openContent && preview?.loadPreview && !loadedPreview && !previewError);
  const previewText = loadedPreview?.text ?? preview?.preview;
  const addedIds = new Set(contextTokens.map((token) => token.id));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, category, project, domain, groupBy, sort, onlySelected]);
  useEffect(() => { setNoteText(""); }, [previewId]);
  useEffect(() => {
    const abort = new AbortController();
    const request = createPreviewRequest({ signal: abort.signal });
    setPreviewResult(undefined);
    if (preview?.loadPreview && !(openContent && preview.resourcePath && references)) {
      void request.stage("read", (signal) => preview.loadPreview!(signal)).then((value) => {
        if (!abort.signal.aborted) setPreviewResult({ asset: preview, value });
      }).catch((error) => {
        if (!abort.signal.aborted) setPreviewResult({ asset: preview, error: previewErrorMessage(error) });
      }).finally(() => request.dispose());
    } else request.dispose();
    return () => { abort.abort(); request.dispose(); };
  }, [preview, previewAttempt, openContent, references?.service]);

  function toggleSelection(id: string, checked: boolean, shift = false) {
    const asset = catalog.find((item) => item.id === id);
    if (asset) selectedAssets.current.set(id, asset);
    const ids = [id];
    if (shift && lastSelection.current) {
      const from = selectionOrder.findIndex((item) => item.id === lastSelection.current), to = selectionOrder.findIndex((item) => item.id === id);
      if (from >= 0 && to >= 0) ids.splice(0, 1, ...selectionOrder.slice(Math.min(from, to), Math.max(from, to) + 1).filter(available).map((item) => { selectedAssets.current.set(item.id, item); return item.id; }));
    }
    lastSelection.current = id;
    setSelected((current) => {
      const next = new Set(current);
      for (const selectedId of ids) { if (checked) next.add(selectedId); else next.delete(selectedId); }
      return next;
    });
  }

  async function addResolved(asset: AssistantComposerSuggestion, resolve: () => Promise<AssistantContextToken>, creating = false) {
    const guardedResolve = async () => {
      const token = await resolve();
      if (!mounted.current || !catalogRef.current.some((current) => current.id === asset.id && current.scopeId === asset.scopeId && (creating || !current.unavailableReason))) {
        throw new Error("资产或当前会话已变化，请重新选择。");
      }
      const merged = mergeContextSelection([...contextTokens, ...acceptedTokens.current], token);
      if (!merged) throw Object.assign(new Error("已加入对话"), { alreadyAdded: true });
      return merged;
    };
    if (onResolveContextToken) {
      let resolutionError: unknown;
      let resolvedToken: AssistantContextToken | undefined;
      const result = await onResolveContextToken(async () => {
        try { const token = await guardedResolve(); resolvedToken = token; return token; }
        catch (error) { resolutionError = error; throw error; }
      });
      if (resolutionError) throw resolutionError;
      if (result === false) throw new Error("未能加入当前会话，请重试。");
      if (resolvedToken) acceptedTokens.current.push(resolvedToken);
    } else if (onAddContextToken) {
      const token = await guardedResolve(); onAddContextToken(token); acceptedTokens.current.push(token);
    } else throw new Error("当前会话尚未就绪，请稍后重试。");
  }

  async function addPreview(asset: AssistantComposerSuggestion) {
    if (onChooseReference && asset.resourcePath) {
      onChooseReference({ path: asset.resourcePath, title: asset.label, detail: asset.detail }); onClose(); return;
    }
    if (operation.current || !available(asset)) return;
    operation.current = true;
    setBusy(true); setErrors([]);
    try {
      await addResolved(asset, asset.resolveToken ?? (() => Promise.resolve(asset.token!)));
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) setErrors([error instanceof Error ? error.message : "添加失败，请重试。"]);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function addSelection() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setErrors([]); setStatus("");
    const failures: string[] = [];
    let count = 0;
    for (const id of selected) {
      if (!mounted.current) break;
      const asset = catalogRef.current.find((candidate) => candidate.id === id);
      if (!asset || !available(asset)) { failures.push(`${asset?.label ?? selectedAssets.current.get(id)?.label ?? id}：${asset?.unavailableReason ?? tChinese("contextCatalog.unavailable", "资产已不可用，请重新选择。")}`); continue; }
      try {
        await addResolved(asset, asset.resolveToken ?? (() => Promise.resolve(asset.token!)));
        if (!mounted.current) break;
        count += 1;
        toggleSelection(id, false);
      } catch (error) {
        if (error && typeof error === "object" && "alreadyAdded" in error) { toggleSelection(id, false); continue; }
        failures.push(`${asset.label}：${error instanceof Error ? error.message : "添加失败，请重试。"}`);
      }
    }
    operation.current = false;
    if (!mounted.current) return;
    setBusy(false); setErrors(failures);
    setStatus(count ? `已添加 ${count} 项上下文。` : "尚未添加上下文。");
  }

  async function createAsset(asset: AssistantComposerSuggestion, kind: "copy" | "note") {
    if (operation.current) return;
    const resolve = kind === "copy" ? asset.createEditableCopy : asset.createNote ? () => asset.createNote!(noteText.trim()) : undefined;
    if (!resolve) return;
    operation.current = true;
    setBusy(true); setErrors([]); setStatus("");
    try {
      await addResolved(asset, resolve, true);
      if (mounted.current) {
        setStatus(kind === "copy" ? "已创建可编辑副本并加入上下文，原始内容保持不变。" : "已保存项目笔记并加入上下文。");
        if (kind === "note") setNoteText("");
      }
    } catch (error) {
      if (mounted.current) setErrors([error instanceof Error ? error.message : "创建失败，请重试。"]);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function selectMany(ids: readonly string[], checked: boolean) {
    for (const id of ids) { const asset = catalog.find((item) => item.id === id); if (asset) selectedAssets.current.set(id, asset); }
    setSelected((current) => { const next = new Set(current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); } return next; });
  }
  const toggleFilter = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface aria-label="上下文资产浏览器" className="context-asset-browser">
      <DialogBody className="context-asset-browser-body">
        <DialogTitle action={<Tooltip content={closeLabel} relationship="label"><Button appearance="subtle"
          aria-label={closeLabel} icon={<DismissRegular />} onClick={onClose} /></Tooltip>}>{onChooseReference ? "插入文件引用" : "添加上下文"}</DialogTitle>
        <DialogContent className="context-asset-browser-content">
          <Input aria-label="搜索全部上下文资产" className="context-asset-search" contentBefore={<SearchRegular />}
            placeholder={tChinese("contextCatalog.searchPlaceholder", "搜索资料")} value={query} onChange={(_, data) => setQuery(data.value)} />
          <div className="context-asset-query-toolbar">
            <Button aria-pressed={domain === "research"} onClick={() => setDomain("research")}>{tChinese("contextCatalog.research", "研究资料")}</Button>
            <Button aria-pressed={domain === "application"} onClick={() => setDomain("application")}>{tChinese("contextCatalog.application", "应用资料")}</Button>
            <SearchOptions query={query} onChange={setQuery} tags={catalog.flatMap((asset) => asset.searchMetadata?.tags ?? [])} facetCounts={snapshot.facetCounts} />
            <OptionPicker aria-label={tChinese("contextCatalog.group", "资料分组")} value={groupBy ?? "none"} onValueChange={(value) => setGroupBy(value as ContextCatalogQuery["groupBy"])} options={[{ value: "none", label: tChinese("contextCatalog.ungrouped", "不分组") }, { value: "project", label: tChinese("contextCatalog.byProject", "按项目") }, { value: "kind", label: tChinese("contextCatalog.byKind", "按种类") }]} />
            <OptionPicker aria-label={tChinese("contextCatalog.sort", "资料排序")} value={sort ?? "title"} onValueChange={(value) => setSort(value as ContextCatalogQuery["sort"])} options={[{ value: "title", label: "标题" }, { value: "updated", label: tChinese("contextCatalog.updated", "最近修改") }]} />
            <Button aria-pressed={view === "list"} onClick={() => setView("list")}>{tChinese("contextCatalog.list", "列表")}</Button>
            <Button aria-pressed={view === "gallery"} onClick={() => setView("gallery")}>{tChinese("contextCatalog.gallery", "图库")}</Button>
          </div>
          <div className={`context-asset-workspace${preview ? " has-preview" : ""}`}>
            <nav className="context-asset-filters" aria-label="上下文资产筛选">
              <strong>类别</strong>
              <Button aria-pressed={!category.length} onClick={() => setCategory([])}>全部类别</Button>
              {categories.map(([kind, count]) => <Button key={kind} appearance={category.includes(kind) ? "secondary" : "subtle"}
                aria-pressed={category.includes(kind)} onClick={() => setCategory(toggleFilter(category, kind))}><span>{contextKindLabels[kind] ?? kind}</span><span>{count}</span></Button>)}
              <strong>项目</strong>
              <Button aria-pressed={!project.length} onClick={() => setProject([])}>全部项目</Button>
              {projects.map(([id, value]) => <Button key={id} appearance={project.includes(id) ? "secondary" : "subtle"}
                aria-pressed={project.includes(id)} title={value.title} onClick={() => setProject(toggleFilter(project, id))}><span>{value.title}</span><span>{value.count}</span></Button>)}
            </nav>
            <section className="context-asset-results" aria-label="可添加资产">
              <div className="context-asset-results-toolbar"><span>{matches.length} 项资产</span>
                {!onChooseReference ? <><Checkbox label={tChinese("contextCatalog.selectFiltered", "全选筛选结果")} disabled={busy || onlySelected || !snapshot.selectableIds.length}
                  checked={snapshot.selectableIds.length > 0 && snapshot.selectableIds.every((id) => selected.has(id)) ? true : snapshot.selectableIds.some((id) => selected.has(id)) ? "mixed" : false}
                  onChange={(_, data) => selectMany(snapshot.selectableIds, data.checked === true)} />
                  <Checkbox label="只看已选" checked={onlySelected} onChange={(_, data) => setOnlySelected(Boolean(data.checked))} /></> : null}
              </div>
              {groups.map((group) => <div key={group.id} className="context-asset-group">
                {group.title ? <div className="context-asset-group-heading"><Button appearance="subtle" aria-expanded={!collapsed.has(group.id)} onClick={() => setCollapsed((current) => new Set(toggleFilter([...current], group.id)))}>{group.title} · {group.items.length}</Button>
                  {!onChooseReference ? <Checkbox aria-label={tChinese("contextCatalog.selectGroup", "全选 {{title}} 的筛选结果", { title: group.title })} disabled={busy || !group.selectableIds.length}
                    checked={group.selectableIds.length > 0 && group.selectableIds.every((id) => selected.has(id)) ? true : group.selectableIds.some((id) => selected.has(id)) ? "mixed" : false}
                    onChange={(_, data) => selectMany(group.selectableIds, data.checked === true)} /> : null}</div> : null}
                {!collapsed.has(group.id) ? <div className={`context-asset-grid ${view === "list" ? "is-list" : "is-gallery"}`}>
                  {group.items.filter((asset) => visibleIds.has(asset.id)).map((asset) => <article key={asset.id} className={`context-asset-card${previewId === asset.id ? " previewing" : ""}`}>
                    {!onChooseReference ? <Checkbox aria-label={`选择 ${asset.label}`} checked={selected.has(asset.id)} disabled={busy || !available(asset) && !selected.has(asset.id)}
                      onChange={(event, data) => { toggleSelection(asset.id, Boolean(data.checked), "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey)); if (data.checked) setPreviewId(asset.id); }} /> : null}
                    {view === "gallery" ? <ContextAssetThumbnail asset={asset} /> : null}
                    <button className="context-asset-card-preview" type="button" aria-label={`预览 ${asset.label}`} aria-pressed={previewId === asset.id} onClick={() => setPreviewId(asset.id)}>
                      <span className="context-asset-card-heading">{categoryOf(asset) === "项目" ? <FolderRegular /> : <DocumentRegular />}<strong><SearchHighlight text={asset.label} query={query} /></strong></span>
                      <span className="context-asset-badges"><span>{categoryOf(asset)}</span>{asset.searchMetadata?.format ? <span>{asset.searchMetadata.format.toUpperCase()}</span> : null}
                        {asset.token && addedIds.has(asset.token.id) ? <span>已加入对话</span> : null}</span>
                      {asset.projectTitle ? <span className="context-asset-card-project">{asset.projectTitle}</span> : null}
                      {asset.searchMetadata?.tags?.length ? <span className="context-asset-card-project">{[...new Set(asset.searchMetadata.tags)].join(" · ")}</span> : null}
                      {asset.unavailableReason ? <span className="context-asset-card-description" role="note">{asset.unavailableReason}</span> : null}
                    </button>
                    {asset.resourcePath && references ? <ResourceLink locator={asset.resourcePath}>{tChinese("contextCatalog.source", "来源")}</ResourceLink> : null}
                  </article>)}
                </div> : null}
              </div>)}
              {!matches.length ? <div className="context-asset-empty"><SearchRegular /><strong>{catalog.length ? "没有匹配的资产" : "还没有可添加的资产"}</strong>
                {catalog.length ? <Button onClick={() => { setQuery(""); setCategory([]); setProject([]); setOnlySelected(false); }}>清除筛选</Button> : null}</div> : null}
              {matches.length > limit ? <Button onClick={() => setLimit((current) => current + PAGE_SIZE)}>显示更多（还有 {matches.length - limit} 项）</Button> : null}
            </section>
            {preview ? <aside className="context-asset-preview" aria-label="资产预览">
                <Tooltip content={tChinese("contextCatalog.closeDetails", "关闭详情")} relationship="label"><Button className="context-asset-preview-close" appearance="subtle" icon={<DismissRegular />} aria-label={tChinese("contextCatalog.closeDetails", "关闭详情")} onClick={() => setPreviewId(undefined)} /></Tooltip>
                <strong>{preview.label}</strong>
                <div className="context-asset-badges"><span>{categoryOf(preview)}</span>{preview.readOnly ? <span>{getAssistantReadOnlyLabel(preview)}</span> : preview.readOnly === false ? <span className="context-asset-editable">可编辑</span> : null}</div>
                {preview.projectTitle ? <p>{preview.projectTitle}</p> : null}
                {preview.detail ? <p>{preview.detail}</p> : null}
                {preview.unavailableReason ? <p role="note">{preview.unavailableReason}</p> : null}
                {previewLoading ? <p role="status">正在读取预览…</p> : null}
                {previewError ? <><p role="alert">{previewError}</p><Button size="small" onClick={() => setPreviewAttempt((value) => value + 1)}>重试预览</Button></> : null}
                {preview.resourcePath && references ? <Button size="small" onClick={() => setOpenContent((value) => !value)}>{openContent ? "返回摘要预览" : "打开内容，选择章节或文字"}</Button> : null}
                {openContent && preview.resourcePath && references ? <ReferenceContentPicker path={preview.resourcePath}
                  actionLabel={onChooseReference ? "插入选中片段引用" : "将选中片段加入对话"} disabled={busy}
                  onChoose={async (document, range) => {
                    if (operation.current) return;
                    operation.current = true; setBusy(true);
                    try {
                      if (onChooseReference) onChooseReference({ path: preview.resourcePath!, title: preview.label, detail: preview.detail }, range.fragment);
                      else await addResolved(preview, () => references.capture(document, range));
                      if (mounted.current) onClose();
                    } finally { operation.current = false; if (mounted.current) setBusy(false); }
                  }} /> : <>
                <strong className="context-asset-preview-heading">供 AI 参考的内容</strong>
                {loadedPreview?.images?.map((image, index) => <img key={index} className="context-asset-preview-image" src={image.url} alt={image.label} />)}
                {!previewLoading && !previewError ? <>
                  {previewText ? <div className="context-asset-preview-text"><ContentView content={legacyContent(previewText)} /></div> :
                    !loadedPreview?.images?.length ? <p>此资产暂无可预览的内容。</p> : null}
                </> : null}
                </>}
                {!onChooseReference && preview.readOnly && preview.createEditableCopy ? <Button icon={<CopyRegular />} disabled={busy || Boolean(preview.unavailableReason)}
                  onClick={() => { void createAsset(preview, "copy"); }}>创建可编辑副本</Button> : null}
                {categoryOf(preview) === "项目" && preview.projectId ? <Button icon={<FolderRegular />}
                  onClick={() => { setProject([preview.projectId!]); setCategory([]); setQuery(""); setOnlySelected(false); }}>浏览此项目资产</Button> : null}
                {!onChooseReference && categoryOf(preview) === "项目" && preview.createNote ? <div className="context-asset-note">
                  <span>新建项目笔记</span>
                  <MarkdownEditor documentKey={`project-note:${preview.projectId}`} label="新建项目笔记" value={noteText} readOnly={busy} onChange={setNoteText} />
                  <Button icon={<AddRegular />} disabled={busy || !noteText.trim()}
                    onClick={() => { void createAsset(preview, "note"); }}>保存并加入上下文</Button>
                </div> : null}
                {onChooseReference ? <Button disabled={!preview.resourcePath} onClick={() => { void addPreview(preview); }}>引用整个文件</Button> : null}
                {!onChooseReference ? <Checkbox label="选择此资产" checked={selected.has(preview.id)} disabled={busy || !available(preview) && !selected.has(preview.id)} onChange={(_, data) => toggleSelection(preview.id, data.checked === true)} /> : null}
            </aside> : null}
          </div>
          {status ? <p className="context-asset-status" role="status">{status}</p> : null}
          {errors.length ? <div className="context-asset-errors" role="alert"><strong>部分操作未完成；已选资产会保留，可重试。</strong>
            <ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div> : null}
        </DialogContent>
        <DialogActions className="context-asset-actions">
          {!onChooseReference ? <span className="context-asset-selection-count" aria-live="polite">已选 {selected.size} 项</span> : null}
          {!onChooseReference ? <Button disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>清空选择</Button> : null}
          <Button onClick={onClose}>{closeLabel}</Button>
          {!onChooseReference ? <Button appearance="primary" icon={<AddRegular />} disabled={busy || !selected.size}
            onClick={() => { void addSelection(); }}>{busy ? "正在处理…" : `添加所选（${selected.size}）`}</Button> : null}
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
