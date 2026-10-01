import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { hybridRank, type View } from "../../../../packages/recommendation-core/index.mjs";
import { ndcg, offTopicRate } from "../../../../packages/recommendation-core/evaluation.mjs";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
const fixture = JSON.parse(readFileSync("../../../../development/test-data/personalized-recommendations/queries.json","utf8")) as { queries: { id: string; views: View[]; candidates: RecommendationItem[]; relevance: Record<string,number> }[] };
test("30 engineering scenarios reject off-topic homonyms and keep evidence grounded", () => {
  expect(fixture.queries.length).toBeGreaterThanOrEqual(30);
  for (const query of fixture.queries) {
    const result = hybridRank(query.candidates,query.views);
    expect(result.length,query.id).toBeGreaterThan(0);
    expect(offTopicRate(result.map((item)=>item.id),query.relevance),query.id).toBe(0);
    expect(result[0].hybrid.evidence.every((entry)=>query.views.some((view)=>view.id===entry.viewId))).toBe(true);
  }
});
test("quality metric penalizes missing highly relevant results and wrong ordering", () => {
  const labels={ a:3,b:2,c:0 }; expect(ndcg(["a","b"],labels)).toBe(1);
  expect(ndcg(["b","a"],labels)).toBeLessThan(1); expect(ndcg(["b"],labels)).toBeLessThan(ndcg(["a"],labels));
});
