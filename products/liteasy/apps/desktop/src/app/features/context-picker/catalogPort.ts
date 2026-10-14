import type { AssistantComposerSuggestion } from "../assistant/assistant.types";
import { contextKind, queryContextCatalog, type ContextCatalogQuery } from "../assistant/contextCatalogQuery";
import { contextUiKind, contextUiKinds, normalizeUiKind } from "../assistant/contextAssetMetadata";
import type { ReadingCatalogEntry } from "../library/readingCatalog.types";
import type { LibraryInventory } from "../library/libraryInventory";
import type { PickerCollection } from "./collectionRegistry";
import type { PickerRoute } from "./pickerState";
import type { PlannedMember, SelectionIntent } from "./selectionPlan";

export type CatalogRelation = { assetId: string; paperIds: string[]; ownerPaperId?: string; revision?: string; createdAt?: string; page?: number; sourceOrder?: number };
export type PickerNode = {
  id: string; title: string; kind: "collection" | "paper" | "category" | "asset";
  route?: PickerRoute; asset?: AssistantComposerSuggestion; entry?: ReadingCatalogEntry;
  count?: number; countState: LibraryInventory["state"]; detail?: string;
  /** Frozen matches from this query, never the currently mounted DOM window. */
  memberIds?: string[]; selectionPolicy?: "originals" | "related"; paperIds?: string[];
};
export type PickerCatalogSource = {
  scope: string; revision: string; entries: readonly ReadingCatalogEntry[]; collections: readonly PickerCollection[];
  assets: readonly AssistantComposerSuggestion[]; relations?: readonly CatalogRelation[];
  inventories?: Readonly<Record<string, LibraryInventory>>;
};
export type HierarchyQuery = Omit<ContextCatalogQuery, "sort"> & { sort?: string; offset?: number; limit?: number; cursor?: string;
  assetIds?: readonly string[]; selectedIds?: readonly string[]; availableOnly?: boolean;
  filters?: { year?: string; readingStatus?: string; availability?: string; page?: string } };
const categories = [
  { id: "original", title: "原文", kinds: ["paper", "document", "text", "page"] },
  { id: "extracted", title: "提取资产", kinds: ["image", "table", "formula"] },
  { id: "notes", title: "笔记与批注", kinds: ["note", "annotation", "excerpt", "board"] },
  { id: "artifacts", title: "AI 产物", kinds: ["artifact", "conversation"] },
  { id: "attachments", title: "附件", kinds: ["other", "file"] },
] as const;
const rootLabels: Record<string, string> = { collections: "Collections", types: "全部资产", recommendations: "推荐", application: "应用上下文" };
const numericTime = (value?: string) => value ? Date.parse(value) || 0 : 0;
const collator = new Intl.Collator("zh-CN", { numeric: true });

/** One immutable metadata snapshot drives hierarchy, facets, counts and selection plans. */
export function createContextCatalogPort(source: PickerCatalogSource) {
  const assets = source.assets.filter(asset => asset.trigger === "@" && (!asset.scopeId || asset.scopeId === source.scope));
  const assetById = new Map(assets.map(asset => [asset.id, asset]));
  const entries = new Map(source.entries.filter(entry => entry.available !== false).map(entry => [entry.id, entry]));
  const relations = new Map((source.relations ?? []).map(relation => [relation.assetId, relation]));
  const byPaper = new Map<string, AssistantComposerSuggestion[]>();
  const owner = (asset: AssistantComposerSuggestion) => {
    const relation = relations.get(asset.id);
    return relation?.ownerPaperId ?? (relation?.paperIds.length === 1 ? relation.paperIds[0] : undefined);
  };
  for (const asset of assets) for (const id of relations.get(asset.id)?.paperIds ?? []) {
    if (entries.has(id)) { const list = byPaper.get(id) ?? []; list.push(asset); byPaper.set(id, list); }
  }
  const memberCollections = new Set(source.collections.flatMap(collection => collection.memberIds));
  const collections: PickerCollection[] = [
    { id: "all-papers", title: "全部论文", memberIds: [...entries.keys()] },
    { id: "uncollected", title: "未归入 Collections", memberIds: [...entries.keys()].filter(id => !memberCollections.has(id)) }, ...source.collections,
  ];
  const collectionById = new Map(collections.map(collection => [collection.id, collection]));
  const inventory = (paperId: string) => source.inventories?.[paperId];
  const paperAt = (route: PickerRoute) => route.findIndex(id => id.startsWith("paper:"));
  function papersFor(route: PickerRoute) {
    const index = paperAt(route);
    return index >= 0 ? [route[index].slice(6)] : route[0] === "collections" && route.length > 1 ? collectionById.get(route[1])?.memberIds ?? [] : [...entries.keys()];
  }
  function scopedAssets(route: PickerRoute) {
    const index = paperAt(route);
    let values = index >= 0 ? byPaper.get(route[index].slice(6)) ?? [] : route[0] === "collections" && route.length > 1
      ? [...new Map(papersFor(route).flatMap(id => byPaper.get(id) ?? []).map(asset => [asset.id, asset])).values()] : assets;
    const category = index >= 0 ? categories.find(item => item.id === route[index + 1]) : undefined;
    if (category) values = values.filter(asset => (category.kinds as readonly string[]).includes(contextKind(asset)));
    if (route.includes("unowned-images")) values = values.filter(asset => !owner(asset) && contextUiKind(asset) === "image");
    if (index >= 0 && route[index + 2]) values = values.filter(asset => contextKind(asset) === route[index + 2]);
    return values.filter(asset => !entries.size || contextKind(asset) !== "project");
  }
  const imageOrders = new Map<string, number>();
  for (const values of byPaper.values()) values.filter(asset => contextKind(asset) === "image").slice().sort(sourceSort).forEach((asset, index) => imageOrders.set(asset.id, index + 1));
  function sourceSort(a: AssistantComposerSuggestion, b: AssistantComposerSuggestion) {
    const left = relations.get(a.id), right = relations.get(b.id);
    return (left?.page ?? Infinity) - (right?.page ?? Infinity) || (left?.sourceOrder ?? Infinity) - (right?.sourceOrder ?? Infinity) || collator.compare(a.id, b.id);
  }
  function assetNode(asset: AssistantComposerSuggestion, insidePaper = false): PickerNode {
    const relation = relations.get(asset.id), kind = contextKind(asset);
    let title = asset.label;
    if (insidePaper && ["text", "page"].includes(kind) && relation?.page) title = `第 ${relation.page} 页`;
    if (insidePaper && kind === "image" && ["论文图片", "图片", "图像"].includes(title.trim())) title = `图片 ${imageOrders.get(asset.id) ?? ""}${relation?.page ? ` · 第 ${relation.page} 页` : ""}`;
    return { id: asset.id, title, kind: "asset", asset, countState: "ready" };
  }
  function paperNode(id: string, route: PickerRoute, matches = byPaper.get(id) ?? [], activeKind = "all"): PickerNode {
    const entry = entries.get(id)!;
    const state = inventory(id)?.state ?? "unknown";
    const detail = state !== "ready" ? state === "error" ? "加载失败" : state === "loading" ? "正在加载" : "清单尚未就绪"
      : activeKind !== "all" ? `${matches.length} 项${contextUiKinds[activeKind] ?? "内容"}` : [entry.year, entry.format.toUpperCase(), `${matches.length} 项内容`].filter(Boolean).join(" · ");
    return { id: `paper:${id}`, title: entry.title, kind: "paper", route: [...route, `paper:${id}`], entry,
      count: state === "ready" ? matches.length : undefined, countState: state,
      detail: activeKind === "image" && inventory(id)?.extraction === "not_extracted" ? "尚未解析" : detail,
      memberIds: activeKind === "all" || activeKind === "document" ? (byPaper.get(id) ?? []).filter(asset => ["paper", "document"].includes(contextKind(asset))).map(asset => asset.id) : matches.map(asset => asset.id), paperIds: [id], selectionPolicy: activeKind === "all" || activeKind === "document" ? "originals" : "related" };
  }
  function categoryNodes(route: PickerRoute, matches: AssistantComposerSuggestion[]) {
    const id = papersFor(route)[0], state = inventory(id)?.state ?? "unknown";
    return categories.flatMap(category => {
      const items = matches.filter(asset => (category.kinds as readonly string[]).includes(contextKind(asset)));
      if (!items.length && state === "ready" && category.id !== "original") return [];
      return [{ id: category.id, title: category.title, kind: "category" as const, route: [...route, category.id], count: state === "ready" ? items.length : undefined, countState: state,
        detail: category.id === "extracted" && inventory(id)?.extraction === "not_extracted" ? "尚未解析" : undefined,
        memberIds: items.map(asset => asset.id), selectionPolicy: "related" as const, paperIds: [id] }];
    });
  }
  const queryCache = new Map<string, ReturnType<typeof executeQuery>>();
  function query(route: PickerRoute, options: HierarchyQuery = {}) {
    const key = JSON.stringify([route, options]); const cached = queryCache.get(key); if (cached) return cached;
    const value = executeQuery(route, options); if (queryCache.size >= 48) queryCache.delete(queryCache.keys().next().value!); queryCache.set(key, value); return value;
  }
  function executeQuery(route: PickerRoute, options: HierarchyQuery) {
    const activeKind = normalizeUiKind(options.activeKind ?? (options.kinds?.length === 1 ? options.kinds[0] : "all"));
    const index = paperAt(route), filters = options.filters;
    const allowed = options.assetIds && new Set(options.assetIds), selected = options.selectedIds && new Set(options.selectedIds);
    const filterAsset = (asset: AssistantComposerSuggestion) => {
      if (allowed && !allowed.has(asset.id) || selected && !selected.has(asset.id)) return false;
      const entry = entries.get(owner(asset) ?? "");
      if (filters?.year && String(entry?.year ?? "") !== filters.year || filters?.readingStatus && entry?.readingStatus !== filters.readingStatus) return false;
      if (filters?.page && String(relations.get(asset.id)?.page ?? "") !== filters.page) return false;
      const ready = !asset.unavailableReason;
      return !((filters?.availability === "ready" || options.availableOnly) && !ready || filters?.availability === "unavailable" && ready);
    };
    const scoped = scopedAssets(route).filter(filterAsset);
    const broader = index >= 0 && route.length > index + 1 ? scopedAssets(route.slice(0, index + 1)).filter(filterAsset) : scoped;
    const result = queryContextCatalog(broader, { ...options, activeKind, sort: options.sort === "updated" ? "updated" : "title" });
    const inRoute = new Set(scoped.map(asset => asset.id));
    const matches = result.matches.filter(asset => inRoute.has(asset.id));
    if (!options.sort || options.sort === "default" || options.sort === "source") matches.sort(sourceSort);
    if (route[0] === "recommendations" && options.assetIds) { const rank = new Map(options.assetIds.map((id, i) => [id, i])); matches.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!); }
    let nodes: PickerNode[];
    if (route[0] === "collections" && route.length === 1) {
      const matching = new Set(matches.flatMap(asset => relations.get(asset.id)?.paperIds ?? []));
      nodes = collections.filter(collection => !options.query && activeKind === "all" && !selected || collection.memberIds.some(id => matching.has(id))).map(collection => {
        const ids = new Set(collection.memberIds);
        return { id: collection.id, title: collection.title, kind: "collection", route: [...route, collection.id], count: collection.memberIds.filter(id => entries.has(id)).length, countState: "ready", paperIds: collection.memberIds,
          memberIds: matches.filter(asset => (relations.get(asset.id)?.paperIds ?? []).some(id => ids.has(id))).map(asset => asset.id), selectionPolicy: activeKind === "all" || activeKind === "document" ? "originals" : "related" };
      });
    } else if (index >= 0) {
      if (route.length === index + 1 && activeKind === "all" && !options.query && !selected) nodes = categoryNodes(route, matches);
      else if (route[index + 1] === "extracted" && route.length === index + 2 && activeKind === "all") nodes = [...new Set(matches.map(contextKind))].map(kind => ({
        id: kind, title: ({ image: "图片", table: "表格", formula: "公式" } as Record<string, string>)[kind] ?? kind,
        kind: "category", route: [...route, kind], count: inventory(papersFor(route)[0])?.state === "ready" ? matches.filter(asset => contextKind(asset) === kind).length : undefined,
        countState: inventory(papersFor(route)[0])?.state ?? "unknown", memberIds: matches.filter(asset => contextKind(asset) === kind).map(asset => asset.id), selectionPolicy: "related", paperIds: papersFor(route),
      }));
      else nodes = matches.map(asset => assetNode(asset, true));
    } else if (route.includes("unowned-images")) nodes = matches.map(asset => assetNode(asset));
    else {
      const grouped = new Map<string, AssistantComposerSuggestion[]>(), standalone: AssistantComposerSuggestion[] = [];
      for (const asset of matches) { const id = owner(asset); if (id && entries.has(id)) { const list = grouped.get(id) ?? []; list.push(asset); grouped.set(id, list); } else standalone.push(asset); }
      if (options.domain !== "application" && route[0] !== "recommendations" && !options.query && !selected && !allowed && !Object.values(filters ?? {}).some(Boolean) && !options.projects?.length) for (const id of papersFor(route)) {
        if (!grouped.has(id) && (activeKind === "all" || inventory(id)?.state !== "ready")) grouped.set(id, []);
      }
      nodes = [...grouped].map(([id, values]) => paperNode(id, route, values, activeKind));
      const images = standalone.filter(asset => contextUiKind(asset) === "image");
      if (images.length && entries.size) nodes.push({ id: "unowned-images", title: "未归属图片", kind: "category", route: [...route, "unowned-images"], count: images.length, countState: "ready", memberIds: images.map(asset => asset.id), selectionPolicy: "related", paperIds: [] });
      nodes.push(...standalone.filter(asset => !entries.size || contextUiKind(asset) !== "image").map(asset => assetNode(asset)));
    }
    nodes.sort((a, b) => {
      if (options.sort === "count") return (b.count ?? -1) - (a.count ?? -1) || collator.compare(a.id, b.id);
      if (options.sort === "year") return (b.entry?.year ?? 0) - (a.entry?.year ?? 0) || collator.compare(a.id, b.id);
      if (options.sort === "author") return collator.compare(a.entry?.authors?.[0] ?? "", b.entry?.authors?.[0] ?? "") || collator.compare(a.id, b.id);
      if (options.sort === "added") return numericTime(b.entry?.addedAt) - numericTime(a.entry?.addedAt) || collator.compare(a.id, b.id);
      if (options.sort === "title") return collator.compare(a.title, b.title) || collator.compare(a.id, b.id);
      if (options.sort === "updated") return numericTime(b.asset?.updatedAt ?? b.entry?.updatedAt) - numericTime(a.asset?.updatedAt ?? a.entry?.updatedAt) || collator.compare(a.id, b.id);
      return 0;
    });
    const fingerprint = JSON.stringify([route, { ...options, offset: undefined, limit: undefined, cursor: undefined }]);
    let offset = options.offset ?? 0;
    if (options.cursor) { const cursor = JSON.parse(options.cursor); if (cursor[0] !== source.revision || cursor[1] !== fingerprint) throw new Error("目录或筛选已变化，请刷新列表。"); offset = cursor[2]; }
    const limit = options.limit ?? 60;
    return { ...result, matches, selectableIds: matches.filter(asset => !asset.unavailableReason && (asset.token || asset.resolveToken) && contextKind(asset) !== "project").map(asset => asset.id), unknownKinds: papersFor(route).some(id => inventory(id)?.state !== "ready") ? ["image", "text"] : [], nodes: nodes.slice(offset, offset + limit), allNodes: nodes, total: nodes.length, snapshot: source.revision,
      cursor: offset + limit < nodes.length ? JSON.stringify([source.revision, fingerprint, offset + limit]) : undefined };
  }
  function children(route: PickerRoute): PickerNode[] { return query(route).allNodes; }
  function validRoute(route: PickerRoute): PickerRoute {
    if (!rootLabels[route[0]]) return ["collections"];
    for (let depth = 1; depth < route.length; depth++) if (!children(route.slice(0, depth)).some(node => node.route?.[depth] === route[depth])) return route.slice(0, depth);
    return route;
  }
  function member(asset: AssistantComposerSuggestion): PlannedMember {
    return { id: asset.id, path: asset.resourcePath, revision: relations.get(asset.id)?.revision ?? asset.resourceRevision, watermark: asset.updatedAt,
      completeText: contextKind(asset) === "paper", representation: contextKind(asset) === "image" ? "image" : ["paper", "document"].includes(contextKind(asset)) ? "reference" : "text" };
  }
  function plan(route: PickerRoute, nodes: PickerNode[], policy: SelectionIntent["policy"]): SelectionIntent {
    const members = new Map<string, PlannedMember>();
    const include = (asset: AssistantComposerSuggestion) => {
      if (!asset.unavailableReason && (asset.token || asset.resolveToken) && contextKind(asset) !== "project") {
        const value = member(asset); members.set(JSON.stringify([source.scope, value.path ?? value.id, value.revision, value.representation]), value);
      }
    };
    for (const node of nodes) {
      if (node.asset) { include(node.asset); continue; }
      const selectionPolicy = node.kind === "paper" || node.kind === "category" ? node.selectionPolicy ?? policy : policy === "filtered" ? node.selectionPolicy ?? "originals" : policy;
      const paperIds = node.paperIds ?? papersFor(node.route ?? route);
      if (selectionPolicy !== "originals" && paperIds.some(id => inventory(id)?.state !== "ready")) throw new Error("关联范围尚未完整，请加载清单后重试。");
      const candidates = node.memberIds ? node.memberIds.flatMap(id => assetById.has(id) ? [assetById.get(id)!] : []) : scopedAssets(node.route ?? route);
      for (const asset of candidates) if (selectionPolicy !== "originals" || ["paper", "document"].includes(contextKind(asset))) include(asset);
    }
    return { id: crypto.randomUUID(), catalogRevision: source.revision, policy, members: [...members.values()], exclusions: [] };
  }
  function locate(id: string): PickerRoute[] {
    return (relations.get(id)?.paperIds ?? []).flatMap(paperId => {
      const asset = assetById.get(id), category = categories.find(value => (value.kinds as readonly string[]).includes(asset ? contextKind(asset) : ""));
      return collections.filter(collection => collection.memberIds.includes(paperId)).map(collection => ["collections", collection.id, `paper:${paperId}`, ...(category ? [category.id, ...(category.id === "extracted" ? [contextKind(asset!)] : [])] : [])]);
    });
  }
  function breadcrumbs(route: PickerRoute) { return route.map((id, index) => ({ route: route.slice(0, index + 1), title: index === 0 ? rootLabels[id] : children(route.slice(0, index)).find(node => node.route?.[index] === id)?.title ?? "位置不可用" })); }
  return { scope: source.scope, revision: source.revision, assets, assetById, relations, entries, query, children, plan, member, locate, validRoute, breadcrumbs };
}
export type ContextCatalogPort = ReturnType<typeof createContextCatalogPort>;
