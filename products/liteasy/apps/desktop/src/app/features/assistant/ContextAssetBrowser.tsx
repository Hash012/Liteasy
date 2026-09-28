import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Input, Textarea, Tooltip
} from "@fluentui/react-components";
import { AddRegular, CopyRegular, DismissRegular, DocumentRegular, FolderRegular, SearchRegular } from "@fluentui/react-icons";
import type { AssistantComposerSuggestion, AssistantContextToken } from "./assistant.types";
import { createAssistantSuggestionIndex, getAssistantReadOnlyLabel } from "./assistantSuggestionIndex";
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
};

const PAGE_SIZE = 60;
const categoryOf = (asset: AssistantComposerSuggestion) => asset.category ?? "其他资产";
const available = (asset: AssistantComposerSuggestion) => !asset.unavailableReason && Boolean(asset.token || asset.resolveToken);

/** Uses the same catalog as @ mentions; no secondary asset inventory or eager reads. */
export function ContextAssetBrowser({ suggestions, contextTokens = [], initialQuery = "", initialPreviewId, onClose,
  onAddContextToken, onResolveContextToken }: ContextAssetBrowserProps) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState("");
  const [project, setProject] = useState("");
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
  const catalog = useMemo(() => [...new Map(suggestions.filter((asset) => asset.trigger === "@" &&
    (asset.token || asset.resolveToken || asset.unavailableReason)).map((asset) => [asset.id, asset])).values()], [suggestions]);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const index = useMemo(() => createAssistantSuggestionIndex(catalog), [catalog]);
  const categories = useMemo(() => {
    const result = new Map<string, number>();
    catalog.forEach((asset) => result.set(categoryOf(asset), (result.get(categoryOf(asset)) ?? 0) + 1));
    return [...result].sort(([left], [right]) => left.localeCompare(right, "zh-CN"));
  }, [catalog]);
  const projects = useMemo(() => {
    const result = new Map<string, { title: string; count: number }>();
    catalog.forEach((asset) => {
      if (!asset.projectId) return;
      const previous = result.get(asset.projectId);
      result.set(asset.projectId, { title: asset.projectTitle ?? "未命名项目", count: (previous?.count ?? 0) + 1 });
    });
    return [...result].sort(([, left], [, right]) => left.title.localeCompare(right.title, "zh-CN"));
  }, [catalog]);
  const matches = useMemo(() => index.search("@", query, Infinity, { includePages: true }).filter((asset) =>
    (!category || categoryOf(asset) === category) && (!project || asset.projectId === project) &&
    (!onlySelected || selected.has(asset.id))), [index, query, category, project, onlySelected, selected]);
  const visible = matches.slice(0, limit);
  const preview = catalog.find((asset) => asset.id === previewId);
  const loadedPreview = previewResult?.asset === preview ? previewResult?.value : undefined;
  const previewError = previewResult?.asset === preview ? previewResult?.error : undefined;
  const previewLoading = Boolean(preview?.loadPreview && !loadedPreview && !previewError);
  const previewText = loadedPreview?.text ?? preview?.preview;
  const addedIds = new Set(contextTokens.map((token) => token.id));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, category, project, onlySelected]);
  useEffect(() => { setNoteText(""); }, [previewId]);
  useEffect(() => {
    let active = true;
    setPreviewResult(undefined);
    if (preview?.loadPreview) {
      void preview.loadPreview().then((value) => {
        if (active) setPreviewResult({ asset: preview, value });
      }).catch((error) => {
        if (active) setPreviewResult({ asset: preview, error: error instanceof Error ? error.message : "暂时无法读取预览，请稍后再试。" });
      });
    }
    return () => { active = false; };
  }, [preview, previewAttempt]);
  useEffect(() => {
    const liveIds = new Set(catalog.filter(available).map((asset) => asset.id));
    setSelected((current) => [...current].every((id) => liveIds.has(id)) ? current :
      new Set([...current].filter((id) => liveIds.has(id))));
    if (category && !categories.some(([name]) => name === category)) setCategory("");
    if (project && !projects.some(([id]) => id === project)) setProject("");
  }, [catalog, categories, category, projects, project]);

  function toggleSelection(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function addResolved(asset: AssistantComposerSuggestion, resolve: () => Promise<AssistantContextToken>, creating = false) {
    const guardedResolve = async () => {
      const token = await resolve();
      if (!mounted.current || !catalogRef.current.some((current) => current.id === asset.id && (creating || !current.unavailableReason))) {
        throw new Error("资产或当前会话已变化，请重新选择。");
      }
      return token;
    };
    if (onResolveContextToken) {
      let resolutionError: unknown;
      const result = await onResolveContextToken(async () => {
        try { return await guardedResolve(); }
        catch (error) { resolutionError = error; throw error; }
      });
      if (resolutionError) throw resolutionError;
      if (result === false) throw new Error("未能加入当前会话，请重试。");
    } else if (onAddContextToken) {
      onAddContextToken(await guardedResolve());
    } else throw new Error("当前会话尚未就绪，请稍后重试。");
  }

  async function addPreview(asset: AssistantComposerSuggestion) {
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
      if (!asset || !available(asset)) continue;
      try {
        await addResolved(asset, asset.resolveToken ?? (() => Promise.resolve(asset.token!)));
        if (!mounted.current) break;
        count += 1;
        toggleSelection(id, false);
      } catch (error) {
        failures.push(`${asset.label}：${error instanceof Error ? error.message : "添加失败，请重试。"}`);
      }
    }
    operation.current = false;
    if (!mounted.current) return;
    setBusy(false); setErrors(failures);
    setStatus(count ? `已添加 ${count} 项上下文。可以继续选择，或返回对话。` : "尚未添加上下文。");
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

  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface aria-label="上下文资产浏览器" className="context-asset-browser">
      <DialogBody className="context-asset-browser-body">
        <DialogTitle action={<Tooltip content="返回对话" relationship="label"><Button appearance="subtle"
          aria-label="返回对话" icon={<DismissRegular />} onClick={onClose} /></Tooltip>}>添加上下文</DialogTitle>
        <DialogContent className="context-asset-browser-content">
          <p className="context-asset-intro">搜索名称的一部分，或按类别、项目浏览。论文、笔记和其他文件都从这里加入对话，也可直接拖到输入框。</p>
          <Input aria-label="搜索全部上下文资产" className="context-asset-search" contentBefore={<SearchRegular />}
            placeholder="搜索标题、项目、类别、内容说明或路径；多个关键词可组合" value={query}
            onChange={(_, data) => setQuery(data.value)} />
          <div className="context-asset-workspace">
            <nav className="context-asset-filters" aria-label="上下文资产筛选">
              <strong>类别</strong>
              <Button appearance={category ? "subtle" : "secondary"} aria-pressed={!category} onClick={() => setCategory("")}>
                <span>全部类别</span><span>{catalog.length}</span>
              </Button>
              {categories.map(([name, count]) => <Button key={name} appearance={category === name ? "secondary" : "subtle"}
                aria-pressed={category === name} onClick={() => setCategory(name)}><span>{name}</span><span>{count}</span></Button>)}
              <strong>项目</strong>
              <Button appearance={project ? "subtle" : "secondary"} aria-pressed={!project} onClick={() => setProject("")}>全部项目</Button>
              {projects.map(([id, value]) => <Button key={id} appearance={project === id ? "secondary" : "subtle"}
                aria-pressed={project === id} title={value.title} onClick={() => setProject(id)}>
                <span>{value.title}</span><span>{value.count}</span>
              </Button>)}
              {!projects.length ? <p className="context-asset-muted">当前没有项目资产。</p> : null}
            </nav>
            <section className="context-asset-results" aria-label="可添加资产">
              <div className="context-asset-results-toolbar"><span>{matches.length} 项资产</span>
                <Checkbox label="只看已选" checked={onlySelected} onChange={(_, data) => setOnlySelected(Boolean(data.checked))} />
              </div>
              <div className="context-asset-grid">
                {visible.map((asset) => <article key={asset.id} className={`context-asset-card${previewId === asset.id ? " previewing" : ""}`}>
                  <Checkbox aria-label={`选择 ${asset.label}`} checked={selected.has(asset.id)}
                    disabled={busy || !available(asset)} onChange={(_, data) => {
                      toggleSelection(asset.id, Boolean(data.checked));
                      if (data.checked) setPreviewId(asset.id);
                    }} />
                  <button className="context-asset-card-preview" type="button" aria-label={`预览 ${asset.label}`}
                    aria-pressed={previewId === asset.id} onClick={() => setPreviewId(asset.id)}>
                    <span className="context-asset-card-heading">{categoryOf(asset) === "项目" ? <FolderRegular /> : <DocumentRegular />}<strong>{asset.label}</strong></span>
                    <span className="context-asset-badges"><span>{categoryOf(asset)}</span>{asset.readOnly ? <span>{getAssistantReadOnlyLabel(asset)}</span> : asset.readOnly === false ? <span className="context-asset-editable">可编辑</span> : null}
                      {asset.token && addedIds.has(asset.token.id) ? <span>已加入对话</span> : null}</span>
                    {asset.projectTitle ? <span className="context-asset-card-project">{asset.projectTitle}</span> : null}
                    <span className="context-asset-card-description">{asset.unavailableReason ?? asset.description ?? asset.detail ?? "选择后可加入对话上下文"}</span>
                  </button>
                </article>)}
                {!matches.length ? <div className="context-asset-empty"><SearchRegular /><strong>{catalog.length ? "没有匹配的资产" : "还没有可添加的资产"}</strong>
                  <p>{catalog.length ? "试试更短的关键词，或切换到全部类别、全部项目。" : "导入论文或添加笔记后，可在这里查看和组合资料。"}</p>
                  {catalog.length ? <Button onClick={() => { setQuery(""); setCategory(""); setProject(""); setOnlySelected(false); }}>清除筛选</Button> : null}
                </div> : null}
              </div>
              {matches.length > limit ? <Button onClick={() => setLimit((current) => current + PAGE_SIZE)}>显示更多（还有 {matches.length - limit} 项）</Button> : null}
            </section>
            <aside className="context-asset-preview" aria-label="资产预览">
              {preview ? <>
                <strong>{preview.label}</strong>
                <div className="context-asset-badges"><span>{categoryOf(preview)}</span>{preview.readOnly ? <span>{getAssistantReadOnlyLabel(preview)}</span> : preview.readOnly === false ? <span className="context-asset-editable">可编辑</span> : null}</div>
                {preview.projectTitle ? <p>{preview.projectTitle}</p> : null}
                {preview.description || preview.detail ? <p>{preview.description ?? preview.detail}</p> : null}
                {preview.unavailableReason ? <p role="note">{preview.unavailableReason}</p> : null}
                {previewLoading ? <p role="status">正在读取预览…</p> : null}
                {previewError ? <><p role="alert">{previewError}</p><Button size="small" onClick={() => setPreviewAttempt((value) => value + 1)}>重试预览</Button></> : null}
                <strong className="context-asset-preview-heading">供 AI 参考的内容</strong>
                {loadedPreview?.images?.map((image, index) => <img key={index} className="context-asset-preview-image" src={image.url} alt={image.label} />)}
                {!previewLoading && !previewError ? <>
                  {previewText ? <div className="context-asset-preview-text">{previewText}</div> :
                    !loadedPreview?.images?.length ? <p>此资产暂无可预览的内容。</p> : null}
                  <p className="context-asset-muted">{categoryOf(preview) === "设置" ? "包含当前设置值、用途和生效时间；发送时读取最新设置。" :
                    categoryOf(preview) === "项目" ? "添加整个项目会包含以上资产，也可逐项选择。" : "此处为内容预览，长篇资料会根据问题选取相关片段。"}</p>
                </> : null}
                {preview.readOnly ? <p className="context-asset-muted">{getAssistantReadOnlyLabel(preview) === "原始内容 · 只读"
                  ? "原始资料保留原义；需要修改时，请创建独立副本。" : "此项用于解释与参考。"}</p> : null}
                {preview.readOnly && preview.createEditableCopy ? <Button icon={<CopyRegular />} disabled={busy || Boolean(preview.unavailableReason)}
                  onClick={() => { void createAsset(preview, "copy"); }}>创建可编辑副本</Button> : null}
                {categoryOf(preview) === "项目" && preview.projectId ? <Button icon={<FolderRegular />}
                  onClick={() => { setProject(preview.projectId!); setCategory(""); setQuery(""); setOnlySelected(false); }}>浏览此项目资产</Button> : null}
                {categoryOf(preview) === "项目" && preview.createNote ? <div className="context-asset-note">
                  <label htmlFor="context-project-note">新建项目笔记</label>
                  <Textarea id="context-project-note" value={noteText} resize="vertical" rows={5} disabled={busy}
                    placeholder="记录想法、问题或整理后的内容" onChange={(_, data) => setNoteText(data.value)} />
                  <Button icon={<AddRegular />} disabled={busy || !noteText.trim()}
                    onClick={() => { void createAsset(preview, "note"); }}>保存并加入上下文</Button>
                </div> : null}
                {preview.readOnly === false ? <p className="context-asset-muted">可让 AI 读取内容，并按你的要求修改此资产；实际操作会显示在对话中。</p> : null}
                <Button appearance="primary" icon={<AddRegular />} disabled={busy || !available(preview)}
                  onClick={() => { void addPreview(preview); }}>加入对话</Button>
                <Button disabled={busy || !available(preview)} onClick={() => toggleSelection(preview.id, !selected.has(preview.id))}>
                  {selected.has(preview.id) ? "取消选择此资产" : "选择此资产"}
                </Button>
              </> : <div className="context-asset-empty"><DocumentRegular /><strong>先看看内容</strong><p>点击资产查看说明和预览，勾选需要的资料后批量添加。</p></div>}
            </aside>
          </div>
          {status ? <p className="context-asset-status" role="status">{status}</p> : null}
          {errors.length ? <div className="context-asset-errors" role="alert"><strong>部分操作未完成；已选资产会保留，可重试。</strong>
            <ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div> : null}
        </DialogContent>
        <DialogActions className="context-asset-actions">
          <span className="context-asset-selection-count" aria-live="polite">已选 {selected.size} 项</span>
          <Button disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>清空选择</Button>
          <Button onClick={onClose}>返回对话</Button>
          <Button appearance="primary" icon={<AddRegular />} disabled={busy || !selected.size}
            onClick={() => { void addSelection(); }}>{busy ? "正在处理…" : `添加所选（${selected.size}）`}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
