import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { ResourceLink, ResourceReferenceView } from "../resource-links/ResourceReferenceView";
import { createPreviewRequest, previewErrorMessage } from "../resource-links/previewRequest";
import { contextKind, contextKindLabels, queryContextCatalog, type ContextCatalogQuery } from "./contextCatalogQuery";
import { usePickerState } from "../context-picker/usePickerState";
import { createContextCatalogPort, type ContextCatalogPort, type PickerNode } from "../context-picker/catalogPort";
import { routeKey, type PickerPurpose } from "../context-picker/pickerState";
import { undoSelectionIntent, resolveSelectionBatch, type PlannedMember } from "../context-picker/selectionPlan";
import { PickerNavigation } from "../context-picker/PickerNavigation";
import { readPickerActivity, readRecommendationSettings, recommendContextAssets, type Recommendation } from "../context-picker/recommendations";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import { ContextAssetThumbnail } from "./ContextAssetThumbnail";
import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useContext, useEffect, useMemo, useRef, useState, useId } from "react";
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
  purpose?: PickerPurpose;
  targetDraftId?: string;
  catalogPort?: ContextCatalogPort;
  draftText?: string;
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
export function ContextAssetBrowser(props: ContextAssetBrowserProps) {
  const references = useContext(ResourceReferencesContext);
  const instanceId = useId();
  const scope = references?.service.scope ?? props.suggestions.find(asset => asset.scopeId)?.scopeId ?? "local";
  const target = props.targetDraftId ?? instanceId;
  return <ContextAssetBrowserContent key={`${scope}:${props.purpose ?? "context"}:${target}`} {...props} targetDraftId={target} />;
}
function ContextAssetBrowserContent({ suggestions, contextTokens = [], initialQuery = "", initialPreviewId, onClose,
  onAddContextToken, onResolveContextToken, onChooseReference, purpose = "context", targetDraftId = "draft", catalogPort, draftText = "" }: ContextAssetBrowserProps) {
  const { tChinese } = useUiTranslation();
  const references = useContext(ResourceReferencesContext);
  const scopeId = references?.service.scope ?? suggestions.find(asset => asset.scopeId)?.scopeId ?? "local";
  const hierarchy = catalogPort ?? references?.picker?.catalog;
  const picker = usePickerState({ scope: scopeId, workspace: references?.picker?.workspaceId, purpose, targetDraftId, root: hierarchy ? "collections" : "types", initialQuery, initialPreviewId });
  const { query, kinds: category, projects: project, domain, groupBy, sort, view, previewId } = picker.location;
  const setQuery = (value: string) => picker.setLocation({ query: value, page: 0 });
  const setCategory = (value: string[]) => picker.setLocation({ kinds: value, page: 0 });
  const setProject = (value: string[]) => picker.setLocation({ projects: value, page: 0 });
  const setDomain = (value: "research" | "application") => picker.setLocation({ domain: value, page: 0 });
  const setGroupBy = (value: ContextCatalogQuery["groupBy"]) => picker.setLocation({ groupBy: value, page: 0 });
  const setSort = (value: string) => picker.setLocation({ sort: value, page: 0 });
  const setView = (value: "list" | "gallery") => picker.setLocation({ view: value });
  const setPreviewId = (value: string | undefined) => picker.setLocation({ previewId: value, ...(value !== previewId ? { content: undefined } : {}) });
  const openContent = picker.location.openContent ?? purpose === "reference";
  const setOpenContent = (value: boolean | ((old: boolean) => boolean)) => picker.setLocation({ openContent: typeof value === "function" ? value(openContent) : value });
  const closeLabel = purpose === "reference" ? "返回编辑" : "返回对话";
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const selectedAssets = useRef(new Map<string, AssistantComposerSuggestion>());
  const lastSelection = useRef<string>();
  const selected = new Set(picker.members.map(member => member.id));
  const [onlySelected, setOnlySelected] = useState(false);
  const limit = (picker.location.page + 1) * PAGE_SIZE;
  const setLimit = (value: number | ((old: number) => number)) => picker.setLocation({ page: Math.max(0, Math.ceil((typeof value === "function" ? value(limit) : value) / PAGE_SIZE) - 1) });
  const [wholeConfirmation, setWholeConfirmation] = useState(false);
  const [policy, setPolicy] = useState<"originals" | "related">("originals");
  const [recommendations, setRecommendations] = useState<Recommendation[]>();
  const [recommendationRevision, setRecommendationRevision] = useState(0);
  const resultList = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const lifetime = useRef(new AbortController());
  const close = () => { lifetime.current.abort(); onClose(); };
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<string[]>(() => Object.values(picker.draft.errors));
  const [noteText, setNoteText] = useState("");
  const [previewResult, setPreviewResult] = useState<{ asset: AssistantComposerSuggestion; value?: ContextAssetPreview; error?: string }>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(false);
  const referencePaths = useMemo(() => new Map((references?.suggestions ?? []).map((asset) => [asset.id, asset.resourcePath])), [references?.suggestions]);
  const catalog = useMemo(() => [...new Map([...suggestions, ...(references?.suggestions ?? [])].filter((asset) => asset.trigger === "@" && (!asset.scopeId || asset.scopeId === scopeId) &&
    (asset.token || asset.resolveToken || asset.unavailableReason || onChooseReference && asset.resourcePath)).map((asset) => [asset.id,
      { ...asset, scopeId: asset.scopeId ?? references?.service.scope, resourcePath: asset.resourcePath ?? referencePaths.get(asset.id) }])).values()], [suggestions, referencePaths, references?.service.scope, references?.suggestions, scopeId, onChooseReference]);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const port = useMemo(() => hierarchy ?? createContextCatalogPort({ scope: scopeId, revision: "compat", entries: [], collections: [], assets: catalog }), [hierarchy, scopeId, catalog]);
  const route = picker.browse.route;
  const inHierarchy = Boolean(hierarchy && route[0] === "collections" && !onlySelected);
  const options = { query, domain, projects: project, kinds: category, groupBy, sort, filters: picker.location.filters };
  const hierarchyResult = useMemo(() => inHierarchy ? port.query(route, { ...options, offset: picker.location.page * PAGE_SIZE }) : undefined, [port, route, query, domain, project, category, groupBy, sort, inHierarchy, picker.location.page, picker.location.filters]);
  const recommendationIds = new Set(recommendations?.map(item => item.id));
  const queryCatalog = inHierarchy ? (hierarchyResult?.allNodes.flatMap(node => node.asset ? [node.asset] : []) ?? []) : route[0] === "recommendations" ? catalog.filter(asset => recommendationIds.has(asset.id)) : catalog;
  const snapshot = useMemo(() => queryContextCatalog(queryCatalog, { ...options, sort: sort === "updated" ? "updated" : "title" }), [queryCatalog, query, domain, project, category, groupBy, sort]);
  if (route[0] === "recommendations") snapshot.matches.sort((a, b) => (recommendations?.findIndex(item => item.id === a.id) ?? 0) - (recommendations?.findIndex(item => item.id === b.id) ?? 0));
  if (inHierarchy && hierarchyResult) {
    const order = new Map(hierarchyResult.allNodes.map((node, index) => [node.id, index]));
    const byOrder = (a: AssistantComposerSuggestion, b: AssistantComposerSuggestion) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    snapshot.matches.sort(byOrder); for (const group of snapshot.groups) group.items.sort(byOrder);
  }
  const categories = [...new Set(catalog.map(contextKind))].map((kind) => [kind, snapshot.kindCounts.get(kind) ?? 0] as const);
  const projects = [...new Map(catalog.filter(asset => asset.projectId).map(asset => [asset.projectId!, { title: asset.projectTitle ?? "未命名项目", count: snapshot.projectCounts.get(asset.projectId!) ?? 0 }])).entries()];
  const matches = onlySelected ? [...selected].map(id => catalog.find(asset => asset.id === id) ?? { ...selectedAssets.current.get(id), id, label: id, unavailableReason: "资产已不可用，请重新选择。" } as AssistantComposerSuggestion) : snapshot.matches;
  const visible = matches.slice(Math.max(0, limit - PAGE_SIZE), limit);
  const visibleIds = new Set(visible.map(asset => asset.id));
  const groups = onlySelected || route[0] === "recommendations" ? [{ id: "selected", title: "", items: matches, selectableIds: [] }] : snapshot.groups;
  const selectionOrder = groups.filter(group => !collapsed.has(group.id)).flatMap(group => group.items).filter(asset => visibleIds.has(asset.id));
  const containers = hierarchyResult?.nodes.filter(node => !node.asset) ?? [];
  const containerSelection = useMemo(() => new Map((hierarchyResult?.allNodes ?? []).filter(node => !node.asset).map(node => { try { return [node.id, port.plan(route, [node], route.length < 3 ? policy : "related").members.map(member => member.id)] as const; } catch { return [node.id, [] as string[]] as const; } })), [hierarchyResult, port, policy]);
  const filteredIds = containers.length ? [...new Set([...containerSelection.values()].flat())] : snapshot.selectableIds;
  const acceptedTokens = useRef<AssistantContextToken[]>([]);
  const resolvedIdentities = useRef(new Map<string, string>());
  useEffect(() => {
    const valid = port.validRoute(route);
    if (routeKey(valid) !== routeKey(route)) { picker.navigate(valid); setStatus("原位置已不可用，已返回上级。"); }
  }, [port, route]);
  useEffect(() => {
    if (recommendations !== undefined && recommendationRevision === 0) return;
    if (!port.assets.length) return;
    setRecommendations(recommendContextAssets(port, { now: Date.now(), activePaperId: references?.picker?.activePaperId, question: draftText, excludedIds: contextTokens.map(token => token.id) }, readPickerActivity(scopeId), readRecommendationSettings(scopeId)));
  }, [recommendationRevision, port.assets.length]);
  useEffect(() => {
    const root = resultList.current, anchor = picker.location.anchor;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-picker-id]")];
    const row = rows.find(item => item.dataset.pickerId === anchor?.id);
    if (row && anchor) root.scrollTop = row.offsetTop - root.offsetTop + anchor.offset;
    const focused = rows.find(item => item.dataset.pickerId === picker.location.focusId);
    focused?.querySelector<HTMLElement>("[data-picker-focus]")?.focus({ preventScroll: true });
  }, [routeKey(route), limit]);
  const preview = catalog.find((asset) => asset.id === previewId);
  const loadedPreview = previewResult?.asset === preview ? previewResult?.value : undefined;
  const previewError = previewResult?.asset === preview ? previewResult?.error : undefined;
  const previewLoading = Boolean(!openContent && preview?.loadPreview && !loadedPreview && !previewError);
  const previewText = loadedPreview?.text ?? preview?.preview;
  const addedIds = new Set(contextTokens.map(token => token.id));
  for (const [id, tokenId] of resolvedIdentities.current) if (addedIds.has(tokenId) || acceptedTokens.current.some(token => token.id === tokenId)) addedIds.add(id);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifetime.current.abort(); }; }, []);
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
    if (checked) picker.select({ id: `leaf:${id}`, catalogRevision: port.revision, policy: "items", members: ids.flatMap(value => { const asset = catalog.find(item => item.id === value); return asset ? [port.member(asset)] : []; }), exclusions: [] });
    else picker.exclude(ids);
  }

  async function addResolved(asset: AssistantComposerSuggestion, resolve: () => Promise<AssistantContextToken>, creating = false) {
    let failure: Error | undefined;
    await resolveSelectionBatch({ members: [port.member(asset)], existing: [...contextTokens, ...acceptedTokens.current], signal: lifetime.current.signal,
      active: () => mounted.current,
      resolve: async () => {
        const token = await resolve();
        if (!catalogRef.current.some(current => current.id === asset.id && current.scopeId === asset.scopeId && (creating || !current.unavailableReason))) throw new Error("资产或当前会话已变化，请重新选择。");
        return { ...token, ...(hierarchy ? { requireCompleteContext: true } : {}) };
      },
      commit: async token => {
        if (onResolveContextToken) {
          let acknowledged = false;
          const result = await onResolveContextToken(async () => { lifetime.current.signal.throwIfAborted(); acknowledged = true; return token; });
          if (result === false || !acknowledged) return false;
        } else if (onAddContextToken) onAddContextToken(token);
        else throw new Error("当前会话尚未就绪，请稍后重试。");
        acceptedTokens.current.push(token); resolvedIdentities.current.set(asset.id, token.id);
        return true;
      },
      onReceipt: receipt => {
        if (receipt.status === "alreadyPresent") failure = Object.assign(new Error("已加入对话"), { alreadyAdded: true });
        if (receipt.status === "failed" || receipt.status === "blocked") failure = new Error(receipt.message);
      },
    });
    if (failure) throw failure;
  }

  async function addPreview(asset: AssistantComposerSuggestion) {
    if (onChooseReference && asset.resourcePath) {
      onChooseReference({ path: asset.resourcePath, title: asset.label, detail: asset.detail }); close(); return;
    }
    if (operation.current || !available(asset)) return;
    operation.current = true;
    setBusy(true); setErrors([]);
    try {
      await addResolved(asset, asset.resolveToken ?? (() => Promise.resolve(asset.token!)));
      if (mounted.current) setStatus("已加入当前对话。");
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
      if (!mounted.current || lifetime.current.signal.aborted) break;
      const asset = catalogRef.current.find((candidate) => candidate.id === id);
      if (!asset || !available(asset)) { failures.push(`${asset?.label ?? selectedAssets.current.get(id)?.label ?? id}：${asset?.unavailableReason ?? tChinese("contextCatalog.unavailable", "资产已不可用，请重新选择。")}`); continue; }
      try {
        const member = picker.members.find(value => value.id === id)!;
        if (member.watermark && !member.revision && member.watermark !== asset.updatedAt) throw new Error("来源已更新，请重新选择以确认新版本。");
        await addResolved(asset, (member.revision || member.completeText) && member.path && references?.resolvePickerToken ? () => references.resolvePickerToken!(member) : asset.resolveToken ?? (() => Promise.resolve(asset.token!)));
        picker.setDraft(state => ({ ...state, receipts: { ...state.receipts, [id]: "added" } }));
        if (!mounted.current || lifetime.current.signal.aborted) break;
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
    picker.setDraft(state => ({ ...state, errors: Object.fromEntries(failures.map((message, index) => [String(index), message])) }));
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

  function selectMany(ids: readonly string[], checked: boolean, intentId = `filtered:${routeKey(route)}:${query}:${groupBy}`) {
    for (const id of ids) { const asset = catalog.find(item => item.id === id); if (asset) selectedAssets.current.set(id, asset); }
    if (checked) picker.select({ id: intentId, catalogRevision: port.revision, policy: "filtered", members: ids.flatMap(id => { const asset = catalog.find(item => item.id === id); return asset ? [port.member(asset)] : []; }), exclusions: [] });
    else picker.setDraft(state => undoSelectionIntent(state, intentId));
  }
  function selectNodes(nodes: PickerNode[], checked: boolean, id: string) {
    if (!checked) { picker.setDraft(state => undoSelectionIntent(state, id)); return; }
    try { const intent = port.plan(route, nodes, route.length < 3 ? policy : "related"); picker.select({ ...intent, id }); setErrors([]); }
    catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
  }
  function containerMembers(node: PickerNode) { return containerSelection.get(node.id) ?? []; }
  const wholeNodes = useMemo(() => inHierarchy && (query || Object.values(picker.location.filters ?? {}).some(Boolean)) ? port.query(route, { sort }).allNodes : [], [inHierarchy, port, route, query, sort, picker.location.filters]);
  function keyboard(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); searchInput.current?.focus(); }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); picker.back(); }
    if (event.key === "Escape" && previewId) { event.preventDefault(); event.stopPropagation(); setPreviewId(undefined); }
    if (!target.closest(".context-asset-results") || target.closest("input,textarea,[role=combobox]")) return;
    const rows = [...(resultList.current?.querySelectorAll<HTMLButtonElement>("[data-picker-focus]") ?? [])], index = rows.findIndex(row => row === target.closest("[data-picker-focus]"));
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); if (inHierarchy && containers.length) selectNodes(hierarchyResult!.allNodes, true, `all:${routeKey(route)}:${query}`); else selectMany(snapshot.selectableIds, true); }
    if (index >= 0 && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))); rows[next].focus(); if (event.shiftKey && !lastSelection.current && rows[index].dataset.assetId) lastSelection.current = rows[index].dataset.assetId; if (event.shiftKey && rows[next].dataset.assetId) toggleSelection(rows[next].dataset.assetId!, true, true); }
    if (event.key === " " && target.dataset.nodeId) { event.preventDefault(); const node = containers.find(node => node.id === target.dataset.nodeId); if (node) selectNodes([node], !containerMembers(node).every(id => selected.has(id)), `container:${routeKey(node.route!)}`); }
    if (event.key === " " && target.dataset.assetId) { event.preventDefault(); toggleSelection(target.dataset.assetId, !selected.has(target.dataset.assetId), event.shiftKey); }
  }
  const toggleFilter = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return <Dialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
    <DialogSurface aria-label="上下文资产浏览器" className="context-asset-browser" onKeyDown={keyboard}>
      <DialogBody className="context-asset-browser-body">
        <DialogTitle action={<Tooltip content={closeLabel} relationship="label"><Button appearance="subtle"
          aria-label={closeLabel} icon={<DismissRegular />} onClick={close} /></Tooltip>}>{onChooseReference ? "插入文件引用" : "添加上下文"}</DialogTitle>
        <DialogContent className="context-asset-browser-content">
          <PickerNavigation picker={picker} catalog={port} activePaperId={references?.picker?.activePaperId} scope={scopeId} onRefresh={() => setRecommendationRevision(value => value + 1)} />
          <Input ref={searchInput} aria-label={inHierarchy ? "搜索当前范围" : "搜索全部上下文资产"} className="context-asset-search" contentBefore={<SearchRegular />}
            placeholder={tChinese("contextCatalog.searchPlaceholder", "搜索资料")} value={query} onChange={(_, data) => setQuery(data.value)} />
          <div className="context-asset-query-toolbar">
            <Button aria-pressed={domain === "research"} onClick={() => setDomain("research")}>{tChinese("contextCatalog.research", "研究资料")}</Button>
            <Button aria-pressed={domain === "application"} onClick={() => setDomain("application")}>{tChinese("contextCatalog.application", "应用资料")}</Button>
            <SearchOptions query={query} onChange={setQuery} tags={catalog.flatMap((asset) => asset.searchMetadata?.tags ?? [])} facetCounts={snapshot.facetCounts} />
            <OptionPicker aria-label={tChinese("contextCatalog.group", "资料分组")} value={groupBy ?? "none"} onValueChange={(value) => setGroupBy(value as ContextCatalogQuery["groupBy"])} options={[{ value: "none", label: tChinese("contextCatalog.ungrouped", "不分组") }, { value: "project", label: tChinese("contextCatalog.byProject", "按项目") }, { value: "kind", label: tChinese("contextCatalog.byKind", "按种类") }]} />
            <OptionPicker aria-label={tChinese("contextCatalog.sort", "资料排序")} value={sort ?? "title"} onValueChange={(value) => setSort(value)} options={[{ value: "default", label: "默认顺序" }, { value: "title", label: "标题" }, { value: "updated", label: tChinese("contextCatalog.updated", "最近修改") }, ...(inHierarchy && route.length === 2 ? [{ value: "year", label: "年份" }, { value: "author", label: "作者" }, { value: "added", label: "加入时间" }] : []), ...(inHierarchy && route.length < 4 ? [{ value: "count", label: "可用项数" }] : []), ...(inHierarchy && route.length >= 3 ? [{ value: "source", label: "原文顺序" }] : [])]} />
            <Button aria-pressed={view === "list"} onClick={() => setView("list")}>{tChinese("contextCatalog.list", "列表")}</Button>
            <Button aria-pressed={view === "gallery"} onClick={() => setView("gallery")}>{tChinese("contextCatalog.gallery", "图库")}</Button>
          </div>
          {inHierarchy ? <div className="context-picker-metadata-filters">
            {route.length === 2 ? <><Input aria-label="筛选年份" placeholder="年份" value={picker.location.filters?.year ?? ""} onChange={(_, data) => picker.setLocation({ page: 0, filters: { ...picker.location.filters, year: data.value } })} />
              <OptionPicker aria-label="阅读状态" value={picker.location.filters?.readingStatus ?? ""} options={[{ value: "", label: "全部阅读状态" }, { value: "unread", label: "未读" }, { value: "reading", label: "在读" }, { value: "finished", label: "已读" }]} onValueChange={value => picker.setLocation({ page: 0, filters: { ...picker.location.filters, readingStatus: value } })} /></> : null}
            {route.length >= 4 ? <Input aria-label="筛选源页码" placeholder="源页码" value={picker.location.filters?.page ?? ""} onChange={(_, data) => picker.setLocation({ page: 0, filters: { ...picker.location.filters, page: data.value } })} /> : null}
            <OptionPicker aria-label="可用状态" value={picker.location.filters?.availability ?? ""} options={[{ value: "", label: "全部可用状态" }, { value: "ready", label: "可用" }, { value: "unavailable", label: "尚未就绪" }]} onValueChange={value => picker.setLocation({ page: 0, filters: { ...picker.location.filters, availability: value } })} />
          </div> : null}
          <div className={`context-asset-workspace${preview ? " has-preview" : ""}`}>
            <nav className="context-asset-filters" aria-label="上下文资产筛选">
              <Button aria-pressed={route[0] === "collections"} onClick={() => picker.switchEntry("collections")}>Collections</Button>
              <Button aria-pressed={route[0] === "types"} onClick={() => picker.switchEntry("types")}>全部资产</Button>
              <Button aria-pressed={route[0] === "recommendations"} onClick={() => picker.switchEntry("recommendations")}>推荐</Button>
              <strong>类别</strong>
              <Button aria-pressed={!category.length} onClick={() => { picker.switchEntry("types"); setCategory([]); }}>全部类别</Button>
              {categories.map(([kind, count]) => <Button key={kind} appearance={category.includes(kind) ? "secondary" : "subtle"}
                aria-pressed={category.includes(kind)} onClick={() => { if (route[0] === "collections") picker.switchEntry("types"); setCategory(toggleFilter(category, kind)); }}><span>{contextKindLabels[kind] ?? kind}</span><span>{count}</span></Button>)}
              <strong>项目</strong>
              <Button aria-pressed={!project.length} onClick={() => setProject([])}>全部项目</Button>
              {projects.map(([id, value]) => <Button key={id} appearance={project.includes(id) ? "secondary" : "subtle"}
                aria-pressed={project.includes(id)} title={value.title} onClick={() => setProject(toggleFilter(project, id))}><span>{value.title}</span><span>{value.count}</span></Button>)}
            </nav>
            <section ref={resultList} className="context-asset-results" aria-label="可添加资产" onFocusCapture={event => { const id = (event.target as HTMLElement).closest<HTMLElement>("[data-picker-id]")?.dataset.pickerId; if (id) picker.setLocation({ focusId: id }); }} onScroll={event => {
              const root = event.currentTarget, row = [...root.querySelectorAll<HTMLElement>("[data-picker-id]")].find(row => row.getBoundingClientRect().bottom > root.getBoundingClientRect().top);
              if (row?.dataset.pickerId) picker.setLocation({ anchor: { id: row.dataset.pickerId, offset: root.scrollTop - (row.offsetTop - root.offsetTop) } });
            }}>
              <div className="context-asset-results-toolbar"><span>{hierarchyResult?.total ?? matches.length} 项{containers.length ? "内容" : "资产"}</span>
                {!onChooseReference ? <><Checkbox label={tChinese("contextCatalog.selectFiltered", "全选筛选结果")} disabled={busy || onlySelected || (!snapshot.selectableIds.length && !containers.length)}
                  checked={filteredIds.length > 0 && filteredIds.every((id) => selected.has(id)) ? true : filteredIds.some((id) => selected.has(id)) ? "mixed" : false}
                  onChange={(_, data) => containers.length ? selectNodes(hierarchyResult!.allNodes, data.checked === true, `all:${routeKey(route)}:${query}`) : selectMany(snapshot.selectableIds, data.checked === true)} />
                  <Checkbox label="只看已选" checked={onlySelected} onChange={(_, data) => { setOnlySelected(Boolean(data.checked)); picker.setLocation({ page: 0 }); }} /></> : null}
              </div>
              {inHierarchy && purpose === "context" && wholeNodes.length > (hierarchyResult?.total ?? 0) ? <div className="context-picker-whole-group">
                <Button disabled={busy} onClick={() => setWholeConfirmation(true)}>选择本层全部（{wholeNodes.length} 项内容）</Button>
                {wholeConfirmation ? <><span role="status">将包含被当前筛选隐藏的内容；范围按当前清单固定。</span><Button onClick={() => { selectNodes(wholeNodes, true, `whole:${routeKey(route)}`); setWholeConfirmation(false); }}>确认选择全部</Button><Button onClick={() => setWholeConfirmation(false)}>取消</Button></> : null}
              </div> : null}
              {containers.length && purpose === "context" && route.length < 3 ? <OptionPicker aria-label="容器添加范围" value={policy} onValueChange={value => setPolicy(value as typeof policy)} options={[{ value: "originals", label: "全部论文原文" }, { value: "related", label: "所有关联资产" }]} /> : null}
              {containers.map(node => {
                const ids = containerMembers(node);
                return <article className="context-picker-container" key={node.id} data-picker-id={node.id}>
                  {purpose === "context" ? <Checkbox aria-label={`选择 ${node.title}`} disabled={busy || !ids.length} checked={ids.length > 0 && ids.every(id => selected.has(id)) ? true : ids.some(id => selected.has(id)) ? "mixed" : false} onChange={(_, data) => selectNodes([node], data.checked === true, `container:${routeKey(node.route!)}`)} /> : null}
                  <Button appearance="subtle" data-picker-focus data-node-id={node.id} aria-label={`进入 ${node.title}`} onClick={() => { picker.navigate(node.route!); setOnlySelected(false); }}><FolderRegular /><span><strong>{node.title}</strong><small>{node.detail || (node.countState === "ready" ? `${node.count ?? 0} 项` : node.countState === "error" ? "加载失败" : node.countState === "loading" ? "正在加载" : "清单尚未就绪")}</small></span></Button>
                </article>;
              })}
              {groups.map((group) => <div key={group.id} className="context-asset-group">
                {group.title ? <div className="context-asset-group-heading"><Button appearance="subtle" aria-expanded={!collapsed.has(group.id)} onClick={() => setCollapsed((current) => new Set(toggleFilter([...current], group.id)))}>{group.title} · {group.items.length}</Button>
                  {!onChooseReference ? <Checkbox aria-label={tChinese("contextCatalog.selectGroup", "全选 {{title}} 的筛选结果", { title: group.title })} disabled={busy || !group.selectableIds.length}
                    checked={group.selectableIds.length > 0 && group.selectableIds.every((id) => selected.has(id)) ? true : group.selectableIds.some((id) => selected.has(id)) ? "mixed" : false}
                    onChange={(_, data) => selectMany(group.selectableIds, data.checked === true, `group:${routeKey(route)}:${query}:${group.id}`)} /> : null}</div> : null}
                {!collapsed.has(group.id) ? <div className={`context-asset-grid ${view === "list" ? "is-list" : "is-gallery"}`}>
                  {group.items.filter((asset) => visibleIds.has(asset.id)).map((asset) => <article key={asset.id} data-picker-id={asset.id} className={`context-asset-card${previewId === asset.id ? " previewing" : ""}`}>
                    {!onChooseReference ? <Checkbox aria-label={`选择 ${asset.label}`} checked={selected.has(asset.id)} disabled={busy || !available(asset) && !selected.has(asset.id)}
                      onChange={(event, data) => { toggleSelection(asset.id, Boolean(data.checked), "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey)); }} /> : null}
                    {view === "gallery" ? <ContextAssetThumbnail asset={asset} /> : null}
                    <Button appearance="subtle" className="context-asset-card-preview" data-picker-focus data-asset-id={asset.id} type="button" aria-label={`预览 ${asset.label}`} aria-pressed={previewId === asset.id} onClick={() => setPreviewId(asset.id)}>
                      <span className="context-asset-card-heading">{categoryOf(asset) === "项目" ? <FolderRegular /> : <DocumentRegular />}<strong><SearchHighlight text={asset.label} query={query} /></strong></span>
                      <span className="context-asset-badges"><span>{categoryOf(asset)}</span>{asset.searchMetadata?.format ? <span>{asset.searchMetadata.format.toUpperCase()}</span> : null}
                        {(addedIds.has(asset.id) || asset.token && addedIds.has(asset.token.id)) ? <span>已加入对话</span> : null}</span>
                      {route[0] === "recommendations" ? <span className="context-asset-card-project">{recommendations?.find(item => item.id === asset.id)?.reason}</span> : null}
                      {asset.projectTitle ? <span className="context-asset-card-project">{asset.projectTitle}</span> : null}
                      {asset.searchMetadata?.tags?.length ? <span className="context-asset-card-project">{[...new Set(asset.searchMetadata.tags)].join(" · ")}</span> : null}
                      {asset.unavailableReason ? <span className="context-asset-card-description" role="note">{asset.unavailableReason}</span> : null}
                    </Button>
                    {hierarchy && port.locate(asset.id).length ? <Button size="small" onClick={() => { picker.navigate(port.locate(asset.id)[0]); setOnlySelected(false); }}>打开所在位置</Button> : null}
                    {asset.resourcePath && references ? <ResourceLink locator={asset.resourcePath}>{tChinese("contextCatalog.source", "来源")}</ResourceLink> : null}
                  </article>)}
                </div> : null}
              </div>)}
              {!matches.length && !containers.length ? <div className="context-asset-empty"><SearchRegular /><strong>{catalog.length ? "没有匹配的资产" : "还没有可添加的资产"}</strong>
                {catalog.length ? <Button onClick={() => { setQuery(""); setCategory([]); setProject([]); setOnlySelected(false); }}>清除筛选</Button> : null}</div> : null}
              {picker.location.page > 0 ? <Button onClick={() => setLimit(current => current - PAGE_SIZE)}>上一页</Button> : null}
              {(hierarchyResult?.total ?? matches.length) > limit ? <Button onClick={() => setLimit((current) => current + PAGE_SIZE)}>显示更多（还有 {(hierarchyResult?.total ?? matches.length) - limit} 项）</Button> : null}
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
                {openContent && preview.resourcePath && references ? <ReferenceContentPicker key={preview.id} path={preview.resourcePath} initialState={picker.location.content} onStateChange={content => picker.setLocation({ content })}
                  onChooseRanges={purpose === "context" && !addedIds.has(preview.id) ? async (document, ranges) => {
                    if (operation.current) return; operation.current = true; setBusy(true);
                    try {
                      await addResolved(preview, async () => {
                        const tokens: AssistantContextToken[] = [];
                        for (const range of ranges) { lifetime.current.signal.throwIfAborted(); tokens.push(await references.capture(document, range)); }
                        return { id: `ranges:${tokens.map(token => token.id).join(":")}`, kind: "object", label: `${preview.label} · ${ranges.length} 个文本区间`, prompt: "", contextRefs: tokens.flatMap(token => token.contextRefs ?? []) };
                      });
                      picker.exclude([preview.id]); setStatus("已加入排除后的文本区间，可继续选择。");
                    } finally { operation.current = false; if (mounted.current) setBusy(false); }
                  } : undefined}
                  actionLabel={onChooseReference ? "插入选中片段引用" : "将选中片段加入对话"} disabled={busy}
                  onChoose={async (document, range) => {
                    if (operation.current) return;
                    operation.current = true; setBusy(true);
                    try {
                      if (onChooseReference) onChooseReference({ path: preview.resourcePath!, title: preview.label, detail: preview.detail }, range.fragment);
                      else await addResolved(preview, () => references.capture(document, range));
                      if (mounted.current) { if (purpose === "reference") close(); else setStatus("已加入当前对话，可继续选择片段。"); }
                    } finally { operation.current = false; if (mounted.current) setBusy(false); }
                  }} /> : <>
                <strong className="context-asset-preview-heading">来源预览</strong>
                {contextKind(preview) === "paper" && preview.resourcePath && references ? <ResourceReferenceView locator={preview.resourcePath} /> : null}
                {loadedPreview?.images?.map((image, index) => <img key={index} className="context-asset-preview-image" src={image.url} alt={image.label} />)}
                {!previewLoading && !previewError ? <>
                  {previewText ? <div className="context-asset-preview-text"><ContentView content={legacyContent(previewText)} /></div> :
                    !loadedPreview?.images?.length && contextKind(preview) !== "paper" ? <p>此资产暂无可预览的内容。</p> : null}
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
          {!onChooseReference ? <span className="context-asset-selection-count" aria-live="polite"><span>已选 {selected.size} 项</span> · 已在上下文 {new Set([...contextTokens, ...acceptedTokens.current].map(token => token.id)).size} 项</span> : null}
          {!onChooseReference ? <Button disabled={busy || !selected.size} onClick={picker.clear}>清空选择</Button> : null}
          <Button onClick={close}>{closeLabel}</Button>
          {!onChooseReference ? <Button appearance="primary" icon={<AddRegular />} disabled={busy || !selected.size}
            onClick={() => { void addSelection(); }}>{busy ? "正在处理…" : `添加所选（${selected.size}）`}</Button> : null}
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
