import { performance } from "node:perf_hooks";
import { compileSearchQuery } from "../src/app/features/search/searchQuery";
import { indexReadingCatalog, queryReadingCatalog } from "../src/app/features/library/readingCatalogSearch";

// Synthetic local corpus; no user content, network, embeddings or disk-cache timing.
// Run: node node_modules/vite-node/vite-node.mjs scripts/benchmark-search.ts
const paragraphs = Array.from({ length: 3000 }, (_, i) => (
  `${i} Literature retrieval 文献检索 research methods.\n`.repeat(100).slice(0, 4000)
));
const catalog = indexReadingCatalog(paragraphs.map((abstract, i) => ({
  id: `book-${i}`, title: `Research 文献 ${i}`, format: "pdf" as const,
  authors: ["Alice Researcher"], tags: ["精读"], abstract,
})));
function measure(label: string, run: () => unknown) {
  const start = performance.now(); const result = run();
  console.log(JSON.stringify({ label, milliseconds: Math.round((performance.now() - start) * 10) / 10, result }));
}
console.log(JSON.stringify({ documents: paragraphs.length, characters: paragraphs.reduce((sum, text) => sum + text.length, 0) }));
const query = compileSearchQuery("absentword tag:精读 -format:epub");
measure("filtered-fulltext-no-match", () => paragraphs.filter((text) => query.matches(text, { format: "pdf", tags: ["精读"] })).length);
measure("catalog-name-query", () => queryReadingCatalog(catalog, {
  query: "Research tag:精读", format: "all", status: "all", collection: "", year: "", sort: "title", scope: "name",
}).length);
measure("catalog-abstract-query", () => queryReadingCatalog(catalog, {
  query: "absentword tag:精读", format: "all", status: "all", collection: "", year: "", sort: "title",
}).length);
