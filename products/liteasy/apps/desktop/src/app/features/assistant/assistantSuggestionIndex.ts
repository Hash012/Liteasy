import type { AssistantComposerSuggestion } from "./assistant.types";

type SuggestionTrigger = AssistantComposerSuggestion["trigger"];

type IndexedSuggestion = {
  suggestion: AssistantComposerSuggestion;
  searchable: string;
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
    limit?: number
  ) => AssistantComposerSuggestion[];
};

const indexes = new WeakMap<readonly AssistantComposerSuggestion[], AssistantSuggestionIndex>();
const MAX_CACHED_SEARCHES = 32;

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
    buckets[suggestion.trigger].push({
      suggestion,
      searchable: normalize(`${label} ${suggestion.detail ?? ""}`),
      page: suggestion.token?.kind === "page"
    });
    if (suggestion.trigger === "/") commands.push(suggestion.insertText ?? `/${label}`);
  }
  commands.sort((left, right) => right.length - left.length);

  const cache = new Map<string, SearchResult>();
  const index: AssistantSuggestionIndex = {
    commands,
    search(trigger, query, limit = 100) {
      const normalizedQuery = normalize(query).trim().replace(/\s+/g, " ");
      const resultLimit = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));
      const key = JSON.stringify([trigger, normalizedQuery, resultLimit]);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached.suggestions;
      }

      const allowPages = /(?:p\.?|第)\s*\d/i.test(normalizedQuery);
      let candidates = buckets[trigger];
      let longestPrefix = -1;
      for (const previous of cache.values()) {
        // A truncated menu is not the full candidate pool. Also, a new page
        // query can reveal candidates that were hidden in its earlier prefix.
        if (previous.trigger === trigger && previous.complete &&
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
          if (!parts.every((part) => candidate.searchable.includes(part))) continue;
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
