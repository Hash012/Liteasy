import type { AssistantComposerSuggestion } from "../assistant/assistant.types";
import { contextKind, queryContextCatalog, type ContextCatalogQuery } from "../assistant/contextCatalogQuery";
import type { ReadingCatalogEntry } from "../library/readingCatalog.types";
import type { LibraryInventory } from "../library/libraryInventory";
import type { PickerCollection } from "./collectionRegistry";
import type { PickerRoute } from "./pickerState";
import type { PlannedMember, SelectionIntent } from "./selectionPlan";

export type CatalogRelation = { assetId: string; paperIds: string[]; revision?: string; createdAt?: string; page?: number; sourceOrder?: number };
export type PickerNode = {
  id: string; title: string; kind: "collection" | "paper" | "category" | "asset";
  route?: PickerRoute; asset?: AssistantComposerSuggestion; entry?: ReadingCatalogEntry;
  count?: number; countState: LibraryInventory["state"]; detail?: string;
};
export type PickerCatalogSource = {
  scope: string; revision: string; entries: readonly ReadingCatalogEntry[]; collections: readonly PickerCollection[];
  assets: readonly AssistantComposerSuggestion[]; relations?: readonly CatalogRelation[];
  inventories?: Readonly<Record<string, LibraryInventory>>;
};
export type HierarchyQuery = Omit<ContextCatalogQuery, "sort"> & { sort?: string; offset?: number; limit?: number; availableOnly?: boolean; filters?: { year?: string; readingStatus?: string; availability?: string; page?: string } };
const categories = [
  { id: "original", title: "原文", kinds: ["paper", "document", "text", "page"] },
  { id: "extracted", title: "提取资产", kinds: ["image", "table", "formula"] },
  { id: "notes", title: "笔记与批注", kinds: ["note", "annotation", "excerpt", "board"] },
  { id: "artifacts", title: "AI 产物", kinds: ["artifact", "conversation"] },
  { id: "attachments", title: "附件", kinds: ["other", "file"] },
] as const;
const rootLabels: Record<string, string> = { collections: "Collections", types: "全部资产", recommendations: "推荐" };
const numericTime = (value?: string) => value ? Date.parse(value) || 0 : 0;

/** An immutable metadata projection. No query, count or selection reads source bodies. */
export function createContextCatalogPort(source: PickerCatalogSource) {
  const assets = source.assets.filter(asset => asset.trigger === "@" && (!asset.scopeId || asset.scopeId === source.scope));
  const assetById = new Map(assets.map(asset => [asset.id, asset]));
  const entries = new Map(source.entries.filter(entry => entry.available !== false).map(entry => [entry.id, entry]));
  const relations = new Map((source.relations ?? []).map(relation => [relation.assetId, relation]));
  const byPaper = new Map<string, AssistantComposerSuggestion[]>();
  for (const asset of assets) for (const id of relations.get(asset.id)?.paperIds ?? []) {
    if (entries.has(id)) { const list = byPaper.get(id) ?? []; list.push(asset); byPaper.set(id, list); }
  }
  const memberCollections = new Set(source.collections.flatMap(collection => collection.memberIds));
  const collections: PickerCollection[] = [
    { id: "all-papers", title: "全部论文", memberIds: [...entries.keys()] },
    { id: "uncollected", title: "未归入 Collections", memberIds: [...entries.keys()].filter(id => !memberCollections.has(id)) },
    ...source.collections,
  ];
  const collectionById = new Map(collections.map(collection => [collection.id, collection]));
  const collectionMembers = new Map(collections.map(collection => [collection.id, new Set(collection.memberIds)]));
  const inventory = (paperId: string) => source.inventories?.[paperId];
  function papersFor(route: PickerRoute) { return route[2]?.startsWith("paper:") ? [route[2].slice(6)] : [...(collectionMembers.get(route[1]) ?? entries.keys())]; }
  const childrenCache = new Map<string, PickerNode[]>();
  function children(route: PickerRoute): PickerNode[] { const key = JSON.stringify(route); let value = childrenCache.get(key); if (!value) { value = buildChildren(route); childrenCache.set(key, value); } return value; }
  function buildChildren(route: PickerRoute): PickerNode[] {
    if (route[0] !== "collections") return assets.map(assetNode);
    if (route.length === 1) return collections.map(collection => ({ id: collection.id, title: collection.title, kind: "collection", route: [...route, collection.id], count: collection.memberIds.filter(id => entries.has(id)).length, countState: "ready" }));
    if (route.length === 2) return (collectionById.get(route[1])?.memberIds ?? []).flatMap(id => {
      const entry = entries.get(id); return entry ? [{ id: `paper:${id}`, title: entry.title, kind: "paper" as const, route: [...route, `paper:${id}`], entry,
        count: inventory(id)?.state === "ready" ? inventory(id)!.items.length : undefined, countState: inventory(id)?.state ?? "unknown" as const,
        detail: [entry.authors?.join("、"), entry.year, entry.format.toUpperCase()].filter(Boolean).join(" · ") }] : [];
    });
    const paperId = route[2].slice(6), candidates = byPaper.get(paperId) ?? [], state = inventory(paperId)?.state ?? "unknown";
    if (route.length === 3) return categories.flatMap(category => {
      const items = candidates.filter(asset => (category.kinds as readonly string[]).includes(contextKind(asset)));
      if (!items.length && state === "ready" && category.id !== "original") return [];
      return [{ id: category.id, title: category.title, kind: "category" as const, route: [...route, category.id], count: state === "ready" ? items.length : undefined, countState: state,
        detail: category.id === "extracted" && inventory(paperId)?.extraction === "not_extracted" ? "尚未解析" : undefined }];
    });
    const category = categories.find(item => item.id === route[3]);
    const items = candidates.filter(asset => (category?.kinds as readonly string[] | undefined)?.includes(contextKind(asset)));
    if (route[3] === "extracted" && route.length === 4) return [...new Set(items.map(contextKind))].map(kind => ({ id: kind, title: ({ image: "图片", table: "表格", formula: "公式" } as Record<string, string>)[kind] ?? kind,
      kind: "category", route: [...route, kind], count: state === "ready" ? items.filter(asset => contextKind(asset) === kind).length : undefined, countState: state }));
    return items.filter(asset => !route[4] || contextKind(asset) === route[4]).map(assetNode);
  }
  function assetNode(asset: AssistantComposerSuggestion): PickerNode { return { id: asset.id, title: asset.label, kind: "asset", asset, countState: "ready" }; }
  function validRoute(route: PickerRoute): PickerRoute {
    if (!rootLabels[route[0]]) return ["collections"];
    if (route[0] !== "collections") return [route[0]];
    for (let depth = 1; depth < route.length; depth++) if (!children(route.slice(0, depth)).some(node => node.route?.[depth] === route[depth])) return route.slice(0, depth);
    return route;
  }
  const queryCache = new Map<string, ReturnType<typeof executeQuery>>();
  function query(route: PickerRoute, options: HierarchyQuery = {}) {
    const key = JSON.stringify([route, options]); const cached = queryCache.get(key); if (cached) return cached;
    const value = executeQuery(route, options); if (queryCache.size >= 64) queryCache.delete(queryCache.keys().next().value!); queryCache.set(key, value); return value;
  }
  function executeQuery(route: PickerRoute, options: HierarchyQuery = {}) {
    const nodes = children(route);
    const projections = nodes.map(node => node.asset ?? ({ id: node.id, label: node.title, trigger: "@", category: node.kind === "paper" ? "论文" : "其他资产",
      updatedAt: node.entry?.updatedAt, keywords: [node.detail ?? ""], searchMetadata: { tags: node.entry?.tags, format: node.entry?.format } } satisfies AssistantComposerSuggestion));
    const result = queryContextCatalog(projections, { ...options, sort: options.sort === "updated" ? "updated" : "title" });
    const byId = new Map(nodes.map(node => [node.id, node]));
    let matched = result.matches.map(asset => byId.get(asset.id)!).filter(node => !options.availableOnly || (node.asset ? !node.asset.unavailableReason : node.countState === "ready"));
    matched = matched.filter(node => {
      const filters = options.filters;
      if (filters?.year && String(node.entry?.year ?? "") !== filters.year) return false;
      if (filters?.readingStatus && node.entry?.readingStatus !== filters.readingStatus) return false;
      if (filters?.page && String(relations.get(node.id)?.page ?? "") !== filters.page) return false;
      if (filters?.availability === "ready" && (node.asset ? Boolean(node.asset.unavailableReason) : node.countState !== "ready")) return false;
      if (filters?.availability === "unavailable" && (node.asset ? !node.asset.unavailableReason : node.countState === "ready")) return false;
      return true;
    });
    matched = matched.sort((a, b) => {
      if (options.sort === "count") return (b.count ?? -1) - (a.count ?? -1) || a.id.localeCompare(b.id);
      if (options.sort === "year") return (b.entry?.year ?? 0) - (a.entry?.year ?? 0) || a.id.localeCompare(b.id);
      if (options.sort === "author") return (a.entry?.authors?.[0] ?? "").localeCompare(b.entry?.authors?.[0] ?? "") || a.id.localeCompare(b.id);
      if (options.sort === "added") return numericTime(b.entry?.addedAt) - numericTime(a.entry?.addedAt) || a.id.localeCompare(b.id);
      if (options.sort === "source" || route.length >= 3 && (!options.sort || options.sort === "default")) return (relations.get(a.id)?.sourceOrder ?? relations.get(a.id)?.page ?? categories.findIndex(item => item.id === a.id)) - (relations.get(b.id)?.sourceOrder ?? relations.get(b.id)?.page ?? categories.findIndex(item => item.id === b.id)) || a.id.localeCompare(b.id);
      return 0;
    });
    const offset = options.offset ?? 0, limit = options.limit ?? 60;
    return { ...result, nodes: matched.slice(offset, offset + limit), allNodes: matched, total: matched.length, snapshot: source.revision,
      cursor: offset + limit < matched.length ? JSON.stringify([source.revision, offset + limit]) : undefined };
  }
  function member(asset: AssistantComposerSuggestion): PlannedMember {
    return { id: asset.id, path: asset.resourcePath, revision: relations.get(asset.id)?.revision, watermark: asset.updatedAt,
      completeText: contextKind(asset) === "paper",
      representation: contextKind(asset) === "image" ? "image" : ["paper", "document"].includes(contextKind(asset)) ? "reference" : "text" };
  }
  function plan(route: PickerRoute, nodes: PickerNode[], policy: SelectionIntent["policy"]): SelectionIntent {
    const members = new Map<string, PlannedMember>();
    const include = (asset: AssistantComposerSuggestion) => { if (!asset.unavailableReason && (asset.token || asset.resolveToken) && contextKind(asset) !== "project") members.set(asset.id, member(asset)); };
    for (const node of nodes) {
      if (node.asset) { include(node.asset); continue; }
      const target = node.route ?? route;
      for (const paperId of papersFor(target)) {
        if (policy !== "originals" && inventory(paperId)?.state !== "ready") throw new Error("关联范围尚未完整，请加载清单后重试。");
        for (const asset of byPaper.get(paperId) ?? []) {
          const kind = contextKind(asset), category = categories.find(value => value.id === target[3]);
          if (policy === "originals" ? !["paper", "document"].includes(kind) : category && !(category.kinds as readonly string[]).includes(kind)) continue;
          if (target[4] && kind !== target[4]) continue;
          include(asset);
        }
      }
    }
    return { id: crypto.randomUUID(), catalogRevision: source.revision, policy, members: [...members.values()], exclusions: [] };
  }
  function locate(id: string): PickerRoute[] {
    return (relations.get(id)?.paperIds ?? []).flatMap(paperId => {
      const asset = assetById.get(id), category = categories.find(value => (value.kinds as readonly string[]).includes(asset ? contextKind(asset) : ""));
      return collections.filter(collection => collection.memberIds.includes(paperId)).map(collection => ["collections", collection.id, `paper:${paperId}`, ...(category ? [category.id, ...(category.id === "extracted" ? [contextKind(asset!)] : [])] : [])]);
    });
  }
  function breadcrumbs(route: PickerRoute) {
    return route.map((id, index) => ({ route: route.slice(0, index + 1), title: index === 0 ? rootLabels[id] : children(route.slice(0, index)).find(node => node.route?.[index] === id)?.title ?? "位置不可用" }));
  }
  return { scope: source.scope, revision: source.revision, assets, assetById, relations, entries, query, children, plan, member, locate, validRoute, breadcrumbs };
}
export type ContextCatalogPort = ReturnType<typeof createContextCatalogPort>;
