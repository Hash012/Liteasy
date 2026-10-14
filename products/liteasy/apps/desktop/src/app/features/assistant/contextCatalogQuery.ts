import type { AssistantComposerSuggestion } from "./assistant.types";
import { compileSearchQuery, normalizeSearchValue, searchFormat } from "../search/searchQuery";
import { assistantSuggestionMetadata, createAssistantSuggestionIndex } from "./assistantSuggestionIndex";

import { contextKind, contextKindLabels, contextDomain, contextUiKind, normalizeUiKind } from "./contextAssetMetadata";
export { contextKind, contextKindLabels, contextDomain } from "./contextAssetMetadata";

export const canSelectContextAsset = (asset: AssistantComposerSuggestion) => !asset.unavailableReason && Boolean(asset.token || asset.resolveToken);
export type ContextCatalogQuery = { query?: string; activeKind?: string; domain?: "research" | "application"; projects?: readonly string[]; kinds?: readonly string[]; groupBy?: "none" | "project" | "kind"; sort?: "title" | "updated" };

const indexes = new WeakMap<readonly AssistantComposerSuggestion[], ReturnType<typeof createAssistantSuggestionIndex>>();
const collator = new Intl.Collator("zh-CN", { numeric: true });

/** One metadata-only snapshot drives totals, facet counts, groups and cross-page selection. */
export function queryContextCatalog(catalog: readonly AssistantComposerSuggestion[], options: ContextCatalogQuery) {
  let index = indexes.get(catalog);
  if (!index) { index = createAssistantSuggestionIndex(catalog); indexes.set(catalog, index); }
  const textMatches = index.search("@", options.query ?? "", Infinity, { includePages: true });
  const inDomain = textMatches.filter((asset) => contextDomain(asset) === (options.domain ?? "research"));
  const matchesProject = (asset: AssistantComposerSuggestion) => !options.projects?.length || options.projects.includes(asset.projectId ?? "");
  const activeKind = normalizeUiKind(options.activeKind ?? (options.kinds?.length === 1 ? options.kinds[0] : "all"));
  const matchesKind = (asset: AssistantComposerSuggestion) => activeKind === "all" || contextUiKind(asset) === activeKind;
  const projectCounts = new Map<string, number>(), kindCounts = new Map<string, number>();
  const projectSeen = new Set<string>();
  for (const asset of inDomain) {
    const identity = JSON.stringify([asset.projectId, asset.resourcePath ?? asset.id]);
    if (matchesKind(asset) && asset.projectId && !projectSeen.has(identity)) { projectSeen.add(identity); projectCounts.set(asset.projectId, (projectCounts.get(asset.projectId) ?? 0) + 1); }
  }
  const tokens = compileSearchQuery(options.query ?? "").tokens;
  const facetCounts = Object.fromEntries((["tag", "format", "type", "kind", "origin"] as const).map((field) => {
    const queryWithoutFacet = tokens.filter((token) => token.field !== field && !(field === "tag" && token.field === "tag-any")).map((token) => token.raw).join(" ");
    const counts = new Map<string, number>(), seen = new Set<string>();
    for (const asset of index.search("@", queryWithoutFacet, Infinity, { includePages: true })) {
      if (contextDomain(asset) !== (options.domain ?? "research") || !matchesProject(asset) || field !== "kind" && !matchesKind(asset)) continue;
      const metadata = assistantSuggestionMetadata(asset);
      const values = field === "tag" ? metadata.tags ?? [] : [field === "type" ? metadata.assetType : metadata[field]];
      for (const value of values) {
        if (!value) continue;
        const normalized = field === "format" ? searchFormat(value) : normalizeSearchValue(value);
        const identity = JSON.stringify([normalized, asset.resourcePath ?? asset.id]);
        if (seen.has(identity)) continue;
        seen.add(identity); counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    return [field, counts];
  })) as Record<"tag" | "format" | "type" | "kind" | "origin", Map<string, number>>;
  for (const [kind, count] of facetCounts.kind) { const uiKind = normalizeUiKind(kind); if (uiKind !== "all") kindCounts.set(uiKind, (kindCounts.get(uiKind) ?? 0) + count); }
  const matchingMemberships = inDomain.filter((asset) => matchesProject(asset) && matchesKind(asset));
  const matches = [...new Map(matchingMemberships.map((asset) => [asset.resourcePath ?? asset.id, asset])).values()].sort((a, b) =>
    (options.sort === "updated" ? (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0) : 0) || collator.compare(a.label, b.label) || a.id.localeCompare(b.id));
  const selectable = (items: readonly AssistantComposerSuggestion[]) => items.filter((asset) => contextKind(asset) !== "project" && canSelectContextAsset(asset)).map((asset) => asset.id);
  const grouped = new Map<string, { id: string; title: string; items: AssistantComposerSuggestion[]; selectableIds: string[] }>();
  for (const asset of matches) {
    const id = options.groupBy === "project" ? asset.projectId ?? "" : options.groupBy === "kind" ? contextKind(asset) : "";
    const title = options.groupBy === "project" ? asset.projectTitle ?? "未归属项目" : options.groupBy === "kind" ? contextKindLabels[id] ?? id : "";
    const group = grouped.get(id) ?? { id, title, items: [], selectableIds: [] };
    group.items.push(asset); grouped.set(id, group);
  }
  const groups = [...grouped.values()].map((group) => ({ ...group, selectableIds: selectable(group.items) }));
  return { matches, projectCounts, kindCounts, facetCounts, groups, selectableIds: selectable(matches) };
}
