import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bm25, hybridRank, type View } from "../../../packages/recommendation-core/index.mjs";
import { ndcg, offTopicRate } from "../../../packages/recommendation-core/evaluation.mjs";
import { rankRecommendations } from "../src/app/features/recommendations/recommendationRanking";
import type { RecommendationItem } from "../src/app/features/recommendations/recommendation.types";
const file = process.argv[2] || fileURLToPath(new URL("../../../../../development/test-data/personalized-recommendations/queries.json", import.meta.url));
const fixture = JSON.parse(readFileSync(file,"utf8")) as { version: number; review: { status: string; labelOrigin: string }; queries: { id: string; views: View[]; candidates: RecommendationItem[]; relevance: Record<string,number> }[] };
if (fixture.version !== 1 || fixture.queries.length < 30) throw new Error("Evaluation requires at least 30 versioned queries.");
const modes = ["baseline", "lexical", "hybrid", "hybridProfile"] as const;
const totals = Object.fromEntries(modes.map((mode) => [mode, { ndcg10: 0, offTopicRate10: 0 }]));
for (const query of fixture.queries) {
  const lexical = bm25(query.views.filter((view) => view.kind === "document").map((view) => view.text).join(" "), query.candidates.map((item) => `${item.title} ${item.abstract || ""}`));
  const rankings = {
    baseline: rankRecommendations(query.candidates),
    lexical: query.candidates.map((item,i) => ({ ...item, score: lexical[i] })).filter((item) => item.score>0).sort((a,b) => b.score-a.score),
    hybrid: hybridRank(query.candidates,query.views.filter((view) => view.kind !== "profile")),
    hybridProfile: hybridRank(query.candidates,query.views),
  };
  for (const mode of modes) { const ids=rankings[mode].map((item)=>item.id); totals[mode].ndcg10+=ndcg(ids,query.relevance)/fixture.queries.length; totals[mode].offTopicRate10+=offTopicRate(ids,query.relevance)/fixture.queries.length; }
}
const improvement=totals.hybridProfile.ndcg10/Math.max(.001,totals.baseline.ndcg10)-1;
const vectorsPresent=fixture.queries.every((query)=>query.views.some((view)=>view.vector) && query.candidates.every((item)=>"vector" in item));
console.log(JSON.stringify({ queries: fixture.queries.length, review:fixture.review, vectorsPresent, metrics:totals, relativeNdcgImprovement:improvement,
  defaultEnableGatePassed:fixture.review.status === "human-reviewed" && vectorsPresent && improvement>=.10 && totals.hybridProfile.offTopicRate10<=totals.baseline.offTopicRate10,
  note: "Engineering fixtures validate behavior only. Human labels, real model vectors and a Windows performance report are required before enabling by default." },null,2));
