import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSlate, canonicalCandidate, validateResearchReasons, projectEvidence } from "./v2.mjs";
const row = (id, topic, score = .8) => ({ id, title: `${topic} study ${id}`, relevanceScore: score, relatedDocumentTitles: [topic] });
test("slate covers relevant topics, rejects weak fillers and keeps title ambiguity", () => {
  const items = [row("a", "vectors", .95), row("b", "vectors", .94), row("c", "biology", .9), row("d", "biology", .01)];
  assert.deepEqual(composeSlate(items, { count: 2 }).map(x => x.id), ["a", "c"]);
  assert.equal(composeSlate([items[3]], { count: 3 }).length, 0);
  assert.notEqual(canonicalCandidate({ id: "1", title: "Same", authors: ["A"] }), canonicalCandidate({ id: "2", title: "Same", authors: ["B"] }));
});
test("model cannot invent candidate/evidence IDs or unsupported conclusion", () => {
  assert.throws(() => validateResearchReasons({ reasons: [{ candidateId: "fake", evidenceIds: ["e"], text: "x", role: "next_read" }] }, ["real"], ["e"]));
  assert.throws(() => validateResearchReasons({ reasons: [{ candidateId: "real", evidenceIds: [], text: "Solves", role: "new_evidence" }] }, ["real"], []));
  assert.equal(validateResearchReasons({ reasons: [{ candidateId: "real", evidenceIds: ["e"], text: "Based on the abstract", role: "next_read" }] }, ["real"], ["e"]).length, 1);
});
test("events replace source revisions, reject future/deleted evidence and cap each paper/day", () => {
  const now = Date.UTC(2026, 9, 14), base = { type: "annotation_committed", sourceId: "paper", producerActionId: "annotation", at: now - 1000, text: "vector index", epoch: 1 };
  const result = projectEvidence([{ ...base, id: "old", revision: "1" }, { ...base, id: "new", revision: "2", at: now - 500 }, { ...base, id: "future", at: now + 1000 }], { now, epoch: 1, tombstones: [] });
  assert.deepEqual(result.map(x => x.id), ["new"]);
  assert.equal(projectEvidence(result, { now, epoch: 1, tombstones: ["paper"] }).length, 0);
});
