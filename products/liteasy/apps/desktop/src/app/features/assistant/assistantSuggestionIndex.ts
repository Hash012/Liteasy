import { compileSearchQuery, formatFromName } from "../search/searchQuery";
import type { AssistantComposerSuggestion } from "./assistant.types";

type SuggestionTrigger = AssistantComposerSuggestion["trigger"];

type IndexedSuggestion = {
  suggestion: AssistantComposerSuggestion;
  searchable: string;
  original: string;
  page: boolean;
};

type SearchResult = {
  trigger: SuggestionTrigger;
  query: string;
  allowPages: boolean;
  complete: boolean;
  matches: IndexedSuggestion[];
  suggestions: AssistantComposerSuggestion[];
};

export type AssistantSuggestionIndex = {
  commands: readonly string[];
  search: (
    trigger: SuggestionTrigger,
    query: string,
    limit?: number,
    options?: { includePages?: boolean }
  ) => AssistantComposerSuggestion[];
};

const indexes = new WeakMap<readonly AssistantComposerSuggestion[], AssistantSuggestionIndex>();
const MAX_CACHED_SEARCHES = 32;

export function getAssistantReadOnlyLabel(suggestion: AssistantComposerSuggestion): string | undefined {
  if (!suggestion.readOnly) return undefined;
  return suggestion.createEditableCopy || ["原文", "图片", "阅读文件"].includes(suggestion.category ?? "")
    ? "原始内容 · 只读" : "只读参考";
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\\/g, "/");
}

/**
 * Suggestions are immutable snapshots: replace the array when the catalog changes.
 * Normalize its text once and share the index for repeated use of that snapshot.
 */
export function createAssistantSuggestionIndex(
  suggestions: readonly AssistantComposerSuggestion[]
): AssistantSuggestionIndex {
  const existing = indexes.get(suggestions);
  if (existing) return existing;

  const buckets: Record<SuggestionTrigger, IndexedSuggestion[]> = { "/": [], "@": [], "$": [] };
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const suggestion of suggestions) {
    if (seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    const label = suggestion.label;
    const original = [label, suggestion.detail, suggestion.category, suggestion.projectTitle, suggestion.description, ...(suggestion.keywords ?? []), getAssistantReadOnlyLabel(suggestion)].filter(Boolean).join(" ");
    buckets[suggestion.trigger].push({
      suggestion,
      original,
      searchable: normalize(original),
      page: suggestion.token?.kind === "page"
    });
    if (suggestion.trigger === "/") commands.push(suggestion.insertText ?? `/${label}`);
  }
  commands.sort((left, right) => right.length - left.length);

  const cache = new Map<string, SearchResult>();
  const index: AssistantSuggestionIndex = {
    commands,
    search(trigger, query, limit = 100, options = {}) {
      const compiled = compileSearchQuery(query);
      const advanced = compiled.advanced || Boolean(compiled.error) || /["“”]/.test(query);
      const normalizedQuery = advanced ? query : normalize(query).trim().replace(/\s+/g, " ");
      const resultLimit = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));
      const key = JSON.stringify([trigger, normalizedQuery, resultLimit, Boolean(options.includePages)]);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached.suggestions;
      }

      const allowPages = Boolean(options.includePages) || /(?:p\.?|第)\s*\d/i.test(normalizedQuery);
      let candidates = buckets[trigger];
      let longestPrefix = -1;
      for (const previous of cache.values()) {
        // A truncated menu is not the full candidate pool. Also, a new page
        // query can reveal candidates that were hidden in its earlier prefix.
        if (!advanced && !compileSearchQuery(previous.query).advanced && !compileSearchQuery(previous.query).error && !/["“”]/.test(previous.query) && previous.trigger === trigger && previous.complete &&
          previous.query.length > longestPrefix && normalizedQuery.startsWith(previous.query) &&
          (!allowPages || previous.allowPages)) {
          candidates = previous.matches;
          longestPrefix = previous.query.length;
        }
      }

      const parts = normalizedQuery ? normalizedQuery.split(" ") : [];
      const matches: IndexedSuggestion[] = [];
      if (resultLimit > 0) {
        for (const candidate of candidates) {
          if (candidate.page && !allowPages) continue;
          if (advanced) {
            const suggestion = candidate.suggestion;
            const fallbackFormat = suggestion.category === "论文" ? "pdf" : suggestion.category === "白板" ? "canvas" : suggestion.category === "笔记" ? "markdown" : formatFromName(suggestion.label);
            if (!compiled.matches(candidate.original, suggestion.searchMetadata ?? { format: fallbackFormat, assetType: suggestion.category === "笔记" ? "note" : suggestion.category === "白板" ? "board" : undefined, tags: suggestion.keywords })) continue;
          } else if (!parts.every((part) => candidate.searchable.includes(part))) continue;
          matches.push(candidate);
          if (matches.length >= resultLimit) break;
        }
      }
      const result: SearchResult = {
        trigger,
        query: normalizedQuery,
        allowPages,
        complete: matches.length < resultLimit,
        matches,
        suggestions: matches.map((candidate) => candidate.suggestion)
      };
      cache.set(key, result);
      if (cache.size > MAX_CACHED_SEARCHES) cache.delete(cache.keys().next().value!);
      return result.suggestions;
    }
  };
  indexes.set(suggestions, index);
  return index;
}
