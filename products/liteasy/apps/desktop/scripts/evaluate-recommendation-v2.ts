import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { bm25, hybridRank } from "../../../packages/recommendation-core/index.mjs";
import { composeSlate } from "../../../packages/recommendation-core/v2.mjs";
import { rankRecommendations } from "../src/app/features/recommendations/recommendationRanking";
import type { RecommendationItem } from "../src/app/features/recommendations/recommendation.types";
const fixturePath = new URL("../../../../../development/test-data/personalized-recommendations/queries.json", import.meta.url);
const fixture = JSON.parse(readFileSync(process.argv[3] || fixturePath, "utf8"));
const times: number[] = [], startRss = process.memoryUsage().rss;
const snapshots = fixture.queries.flatMap((query: { id: string; views: Parameters<typeof hybridRank>[1]; candidates: RecommendationItem[] }) => ["2026-09-01T00:00:00Z", "2026-10-14T00:00:00Z"].map(asOf => {
  const now = Date.parse(asOf);
  // Engineering snapshots only: freeze known publication dates and never invent availability for unknowns.
  const candidates = query.candidates.filter(item => !item.publishedAt || Date.parse(item.publishedAt) <= now).slice(0, 200);
  const views = structuredClone(query.views), started = performance.now();
  const old = rankRecommendations(candidates, { now: new Date(now) });
  const lexical = bm25(views.map(view => view.text).join("\n"), candidates.map(item => `${item.title} ${item.abstract || ""}`));
  const lexicalRank = candidates.map((item, index) => ({ ...item, relevanceScore: lexical[index] > 0 ? lexical[index] / (1 + lexical[index]) : 0 })).sort((a, b) => b.relevanceScore - a.relevanceScore);
  const hybrid = hybridRank(candidates, views);
  const slate = composeSlate(hybrid);
  times.push(performance.now() - started);
  if (slate.length > 3 || slate.some(item => !candidates.some(candidate => candidate.id === item.id))) throw new Error("Slate escaped frozen candidate catalogue");
  return { id: `${query.id}:${asOf.slice(0, 10)}`, clusterId: query.id, asOf, provenance: "synthetic-engineering-fixture", candidateIds: candidates.map(item => item.id),
    conditions: { privacy: "local-only", models: "none", recipe: "stable-feed-v2" }, humanLabels: null, review: "pending-human-review",
    modes: { "old-system": old.slice(0, 3).map(item => item.id), "old-top3": old.slice(0, 3).map(item => item.id), "lexical-behavior": composeSlate(lexicalRank).map(item => item.id), "hybrid-facets": slate.map(item => item.id), "hybrid-rerank-llm": { status: "not_run", reason: "No authorized live model / reviewed labels" } } };
}));
const report = { capturedAt: new Date().toISOString(), snapshots, snapshotCount: snapshots.length, sourceReview: fixture.review,
  quality: { ndcgAt3: "not_run", offTopicRateAt3: "not_run", confidenceIntervals: "not_run", defaultModelEnableGatePassed: false, reason: "Engineering replay is not human quality evidence; no labels or improvement fabricated." },
  performance: { platform: platform(), cpu: cpus()[0]?.model, physicalMemoryBytes: totalmem(), configuredCandidateCap: 200, largestFixtureCandidateCount: Math.max(...snapshots.map((snapshot: { candidateIds: string[] }) => snapshot.candidateIds.length)), p95Ms: times.sort((a, b) => a - b)[Math.ceil(times.length * .95) - 1], incrementalRssBytes: process.memoryUsage().rss - startRss, processRssBytes: process.memoryUsage().rss, modelMemoryBytes: 0 },
  nativeWindows: { status: "not_run", reason: "Measured separately by the Windows installer workflow; this report is a Node engineering replay." } };
writeFileSync(process.argv[2] || "/tmp/liteasy-recommendation-v2-evaluation.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ snapshots: report.snapshotCount, quality: report.quality, performance: report.performance }, null, 2));
