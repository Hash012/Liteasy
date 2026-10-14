import { writeFileSync } from "node:fs";
import { platform, cpus } from "node:os";
import { createContextCatalogPort } from "../src/app/features/context-picker/catalogPort";
import { recommendContextAssets, defaultRecommendationSettings, evaluateRecommendations } from "../src/app/features/context-picker/recommendations";
import type { AssistantComposerSuggestion } from "../src/app/features/assistant/assistant.types";
let bodyReads = 0;
const entries = Array.from({ length: 10000 }, (_, index) => ({ id: `p${index}`, title: `论文 ${index}`, format: "pdf" as const, year: 2020 + index % 6 }));
const assets: AssistantComposerSuggestion[] = Array.from({ length: 100000 }, (_, index) => ({ id: `asset-${index}`, trigger: "@", label: `图 ${index}`, scopeId: "performance", category: "图片", searchMetadata: { kind: "image", tags: ["benchmark"] }, token: { id: `asset-${index}`, label: `图 ${index}`, kind: "object", prompt: "" }, loadPreview: async () => { bodyReads++; return { text: "on-demand body" }; } }));
const start = performance.now();
const catalog = createContextCatalogPort({ scope: "performance", revision: "fixture-1", entries, assets, collections: [{ id: "all", title: "All", memberIds: entries.map(entry => entry.id) }],
  inventories: Object.fromEntries(entries.map(entry => [entry.id, { state: "ready", extraction: "ready", items: [] }])), relations: assets.map((asset, index) => ({ assetId: asset.id, paperIds: [`p${Math.floor(index / 10)}`], sourceOrder: index, createdAt: "2026-10-01T00:00:00Z" })) });
const buildMs = performance.now() - start;
const timings: number[] = [], plans: number[] = [];
for (let i = 0; i < 25; i++) {
  const route = ["collections", "all", `paper:p${i}`, "extracted", "image"];
  const before = performance.now(); const result = catalog.query(route, { query: "tag:benchmark", sort: "source" }); timings.push(performance.now() - before);
  const selectionStart = performance.now(); catalog.plan(route, result.allNodes, "filtered"); plans.push(performance.now() - selectionStart);
}
const firstGlobal = performance.now(); const global = catalog.query(["types"], { query: "图 99" }); const globalColdMs = performance.now() - firstGlobal;
const warm: number[] = [];
for (let i = 0; i < 25; i++) { const before = performance.now(); catalog.query(["types"], { query: "图 99" }); warm.push(performance.now() - before); }
const percentile = (samples: number[], p: number) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
const t = Date.parse("2026-10-14T00:00:00Z");
const replay = Array.from({ length: 12 }, (_, i) => {
  const expected = [`asset-${i * 10}`], events = [{ id: expected[0], at: t - 1000, origin: "reader" as const, kind: "viewed" as const }];
  return { expected, ranked: recommendContextAssets(catalog, { now: t, activePaperId: `p${i}` }, events, defaultRecommendationSettings).map(value => value.id), recentBaseline: events.sort((a, b) => b.at - a.at).map(value => value.id) };
});
const result = { environment: { platform: platform(), node: process.version, cpu: cpus()[0]?.model }, entries: entries.length, childNodes: assets.length, bodyReads, buildMs, globalColdMs, globalMatched: global.total,
  warmGlobalP95Ms: percentile(warm, .95), scopedQueryP95Ms: percentile(timings, .95), planP95Ms: percentile(plans, .95),
  recommendationEvaluation: { ...evaluateRecommendations(replay), dataset: "synthetic deterministic metadata replay; no live-user effectiveness evidence" } };
if (bodyReads !== 0) throw new Error("Metadata query unexpectedly read resource bodies");
writeFileSync(process.argv[2] ?? "/tmp/liteasy-context-picker-performance.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
