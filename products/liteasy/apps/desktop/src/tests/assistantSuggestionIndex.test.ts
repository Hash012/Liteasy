import { describe, expect, it } from "vitest";
import { createAssistantSuggestionIndex } from "../app/features/assistant/assistantSuggestionIndex";
import type { AssistantComposerSuggestion } from "../app/features/assistant/assistant.types";

function suggestion(id: string, label: string, detail?: string): AssistantComposerSuggestion {
  return { id, label, detail, trigger: "@" };
}

describe("assistant suggestion index", () => {
  it("matches every query token across labels and paths, ignoring case and path separators", () => {
    const first = suggestion("first", "Attention Notes.md", "D:\\Research Papers\\Transformers");
    const other = suggestion("other", "Attention Notes.md", "/research/archive");
    const index = createAssistantSuggestionIndex([first, other]);

    expect(index.search("@", "  TRANSFORMERS   notes D:/Research  ")).toEqual([first]);
    expect(index.search("@", "attention missing")).toEqual([]);
    expect(index.search("@", "research")).toEqual([first, other]);
  });

  it("separates triggers, preserves catalog order, removes duplicate ids and prepares command highlights", () => {
    const paper = suggestion("paper", "Explain paper");
    const short: AssistantComposerSuggestion = { id: "short", label: "Explain", trigger: "/" };
    const long: AssistantComposerSuggestion = {
      id: "long", label: "Explain deeply", insertText: "/explain-deeply", trigger: "/"
    };
    const skill: AssistantComposerSuggestion = { id: "skill", label: "Explain skill", trigger: "$" };
    const index = createAssistantSuggestionIndex([paper, short, long, skill, { ...paper, label: "Duplicate" }]);

    expect(index.search("@", "")).toEqual([paper]);
    expect(index.search("/", "explain")).toEqual([short, long]);
    expect(index.search("$", "explain")).toEqual([skill]);
    expect(index.commands).toEqual(["/explain-deeply", "/Explain"]);
  });

  it("only reveals page candidates when the query requests a page, including incremental typing", () => {
    const page: AssistantComposerSuggestion = {
      ...suggestion("page", "Paper · p. 12 · 第 12 页"),
      token: { id: "page-token", kind: "page", label: "Page 12", prompt: "Page 12" }
    };
    const paper = suggestion("paper", "Paper");
    const index = createAssistantSuggestionIndex([page, paper]);

    expect(index.search("@", "")).toEqual([paper]);
    expect(index.search("@", "p")).toEqual([paper]);
    expect(index.search("@", "p.")).toEqual([]);
    expect(index.search("@", "p. 1")).toEqual([page]);
    expect(index.search("@", "P. 12")).toEqual([page]);
    expect(index.search("@", "第")).toEqual([]);
    expect(index.search("@", "第 12")).toEqual([page]);
  });

  it("caches by immutable catalog identity and rebuilds when the array changes", () => {
    const catalog = [suggestion("first", "First")];
    const index = createAssistantSuggestionIndex(catalog);
    expect(createAssistantSuggestionIndex(catalog)).toBe(index);
    expect(index.search("@", "FIRST")).toBe(index.search("@", " first "));

    const second = suggestion("second", "Second");
    const updated = createAssistantSuggestionIndex([...catalog, second]);
    expect(updated).not.toBe(index);
    expect(updated.search("@", "second")).toEqual([second]);
    expect(index.search("@", "second")).toEqual([]);
  });

  it("respects limits without dropping later matches when a truncated query is extended", () => {
    const catalog = Array.from({ length: 200 }, (_, i) => suggestion(`${i}`, `Paper ${i}`));
    catalog.push(suggestion("last", "Paper needle"));
    const index = createAssistantSuggestionIndex(catalog);

    expect(index.search("@", "")).toHaveLength(100);
    expect(index.search("@", "paper", 5)).toEqual(catalog.slice(0, 5));
    expect(index.search("@", "paper needle")).toEqual([catalog[200]]);
    expect(index.search("@", "paper", 201)).toEqual(catalog);
    expect(index.search("@", "", 0)).toEqual([]);
    expect(index.search("@", "", 1)).toEqual([catalog[0]]);
  });

  it("does not confuse a complete query's candidates with another trigger or a broader query", () => {
    const exact = suggestion("exact", "Paper needle");
    const broad = suggestion("broad", "Paper different");
    const skill: AssistantComposerSuggestion = { id: "skill", label: "Paper needle", trigger: "$" };
    const index = createAssistantSuggestionIndex([exact, broad, skill]);

    expect(index.search("@", "paper needle")).toEqual([exact]);
    expect(index.search("@", "paper needle missing")).toEqual([]);
    expect(index.search("@", "paper")).toEqual([exact, broad]);
    expect(index.search("$", "paper needle")).toEqual([skill]);
  });

  it.each([10_000, 20_000])("searches a %i-file catalog without reading labels or paths again", (size) => {
    let labelReads = 0;
    let detailReads = 0;
    const catalog: AssistantComposerSuggestion[] = Array.from({ length: size }, (_, position) => ({
      id: `file-${position}`,
      trigger: "@",
      get label() { labelReads += 1; return `Research note ${position}.md`; },
      get detail() { detailReads += 1; return `D:\\Papers\\Group ${position % 20}\\File ${position}`; }
    }));
    const started = performance.now();
    const index = createAssistantSuggestionIndex(catalog);
    const buildMs = performance.now() - started;
    expect(labelReads).toBe(size);
    expect(detailReads).toBe(size);

    let searchMs = 0;
    const search = (query: string) => {
      const started = performance.now();
      const result = index.search("@", query);
      searchMs += performance.now() - started;
      return result;
    };
    expect(search("")).toEqual(catalog.slice(0, 100));
    expect(search("research")).toHaveLength(100);
    expect(search(`research note ${size - 1}.md`)).toEqual([catalog[size - 1]]);
    for (const query of ["g", "gr", "group", "group 19", "group 19 /file", "group 19 /file missing"]) {
      const parts = query.toLowerCase().split(/\s+/);
      const expectedPositions = Array.from({ length: size }, (_, position) => position).filter((position) => {
        const searchable = `research note ${position}.md d:/papers/group ${position % 20}/file ${position}`;
        return parts.every((part) => searchable.includes(part));
      }).slice(0, 100);
      expect(search(query).map((item) => item.id))
        .toEqual(expectedPositions.map((position) => `file-${position}`));
    }
    expect(createAssistantSuggestionIndex(catalog)).toBe(index);
    expect(labelReads).toBe(size);
    expect(detailReads).toBe(size);
    // Timings are diagnostic, not environment-sensitive pass/fail thresholds.
    console.info(`Assistant catalog ${size}: build ${buildMs.toFixed(1)} ms; nine searches ${searchMs.toFixed(1)} ms`);
  });
});
