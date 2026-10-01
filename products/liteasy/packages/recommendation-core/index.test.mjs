import { test } from "node:test";
import assert from "node:assert/strict";
import { bm25, cosine, hybridRank, keywords, terms, rrf } from "./index.mjs";
const pool = [
  { id: "insect", title: "Cicada life cycles and insect habitats", abstract: "Periodical cicada biology and insect population development" },
  { id: "cc", title: "Optimistic transactions and concurrency control", abstract: "Database transaction scheduling with serializable timestamps" },
  { id: "recovery", title: "Database logging and crash recovery", abstract: "Transaction recovery with durable logs and checkpoints" },
];
const document = { id: "seed", kind: "document", title: "Cicada", text: "Cicada: database transaction concurrency control and crash recovery logging" };
test("hybrid retrieval grounds ambiguous acronyms and never promotes unrelated profile matches", () => {
  const ranked = hybridRank(pool, [document, { id: "profile", kind: "profile", title: "insect", text: "insect habitats cicada biology" }]);
  assert.equal(ranked.length, 2); assert.ok(!ranked.some((item) => item.id === "insect"));
});
test("specific annotation questions change ordering; removing a view removes its evidence", () => {
  const rank = (text) => hybridRank(pool, [document, { id: "note", kind: "annotation", title: "Question", text, path: "liteasy://note" }]);
  assert.equal(rank("database logging crash recovery checkpoints")[0].id, "recovery");
  assert.equal(rank("optimistic concurrency transaction scheduling timestamps")[0].id, "cc");
  assert.ok(hybridRank(pool, [document]).every((row) => row.hybrid.evidence.every((value) => value.kind !== "annotation")));
});
test("Chinese segmentation and exact vector dimensions are explicit", () => {
  assert.ok(terms("数据库事务并发控制").includes("database"));
  assert.deepEqual(terms("LLM"), terms("Large language models"));
  assert.deepEqual(terms("大语言模型"), terms("LLMs"));
  assert.ok(bm25("数据库事务", ["database transactions", "insect biology"])[0] > 0);
  assert.equal(cosine([1,0], [1,0]), 1); assert.equal(cosine([1,0], [1]), 0); assert.equal(cosine([0,0], [1,0]), 0);
});
test("keywords are grounded in metadata/text, deduplicate aliases, and preserve provenance", () => {
  const result = keywords({ title: "Episodic memory retrieval for language models", subjects: ["Episodic memory", "episodic memories"], keywords: ["Retrieval"] });
  assert.ok(result.length >= 2); assert.equal(result[0].source, "provider");
  assert.ok(result.every((item) => item.label.length <= 65));
  assert.ok(!result.some((item) => /quantum|biology/.test(item.label)));
});
test("empty RRF routes do not dilute active views, ranks are stable", () => {
  const scores = rrf([{ weight: .7, scores: [{ id: "b", score: 0 }] }, { weight: .3, scores: [{ id: "a", score: 4 }] }]);
  assert.equal(scores.get("a"), 1); assert.equal(scores.has("b"), false);
});
