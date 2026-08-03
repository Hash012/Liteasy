import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./database.mjs";
import { createWorkRepository, WorkRepositoryError } from "./workRepository.mjs";

function createRepository() {
  const database = createDatabase({ databasePath: ":memory:" });
  return createWorkRepository(database);
}

test("resolveWork creates a work on first resolution and is idempotent on second", () => {
  const repo = createRepository();
  const identities = [
    { kind: "doi", value: "10.1145/3459615", sourceProvider: "crossref" },
    { kind: "arxiv", value: "2106.04561", relation: "is_preprint_of", sourceProvider: "arxiv" }
  ];

  const first = repo.resolveWork(identities, { title: "ColBERT", year: 2021, type: "conference" });
  assert.equal(first.created, true);
  assert.ok(first.work.id.startsWith("w_"));

  const second = repo.resolveWork(identities, { title: "ColBERT", year: 2021 });
  assert.equal(second.created, false);
  assert.equal(second.work.id, first.work.id);
});

test("resolveWork merges new identifiers into an existing work", () => {
  const repo = createRepository();
  const first = repo.resolveWork([{ kind: "doi", value: "10.1/abc" }]);
  const second = repo.resolveWork([
    { kind: "doi", value: "10.1/abc" },
    { kind: "arxiv", value: "2401.00001", relation: "is_preprint_of" }
  ]);

  assert.equal(second.work.id, first.work.id);
  assert.equal(second.created, false);
  const kinds = second.identifiers.map((item) => item.kind).sort();
  assert.deepEqual(kinds, ["arxiv", "doi"]);
});

test("resolveWork returns distinct work ids for disjoint identities", () => {
  const repo = createRepository();
  const a = repo.resolveWork([{ kind: "doi", value: "10.1/a" }]);
  const b = repo.resolveWork([{ kind: "doi", value: "10.1/b" }]);
  assert.notEqual(a.work.id, b.work.id);
});

test("resolveWork persists version relations on identifiers", () => {
  const repo = createRepository();
  const result = repo.resolveWork([
    { kind: "doi", value: "10.1/published" },
    { kind: "arxiv", value: "2401.00002", relation: "is_preprint_of" }
  ]);
  const arxiv = result.identifiers.find((item) => item.kind === "arxiv");
  assert.equal(arxiv.relation, "is_preprint_of");
  const doi = result.identifiers.find((item) => item.kind === "doi");
  assert.equal(doi.relation, "same_as");
});

test("resolveWork chooses canonical provider by identity priority", () => {
  const repo = createRepository();
  const result = repo.resolveWork([
    { kind: "arxiv", value: "2401.00003", sourceProvider: "arxiv" },
    { kind: "doi", value: "10.1/canonical", sourceProvider: "crossref" }
  ]);
  // doi outranks arxiv → canonical provider crossref, canonical id 10.1/canonical
  assert.equal(result.work.canonicalProvider, "crossref");
  assert.equal(result.work.canonicalId, "10.1/canonical");
});

test("resolveWork throws when no valid identity is provided", () => {
  const repo = createRepository();
  assert.throws(
    () => repo.resolveWork([{ kind: "bogus", value: "x" }]),
    (error) => error instanceof WorkRepositoryError && error.code === "no_valid_identity"
  );
});

test("addCitationEdge writes an outgoing edge and is idempotent", () => {
  const repo = createRepository();
  const source = repo.resolveWork([{ kind: "doi", value: "10.1/src" }]);
  const target = repo.resolveWork([{ kind: "doi", value: "10.1/tgt" }]);

  const edge = repo.addCitationEdge({
    relationType: "cites",
    sourceProvider: "openalex",
    sourceWorkId: source.work.id,
    targetWorkId: target.work.id,
    verified: true
  });
  assert.equal(edge.relationType, "cites");

  // Idempotent re-write (no throw, stays one row).
  repo.addCitationEdge({
    relationType: "cites",
    sourceProvider: "openalex",
    sourceWorkId: source.work.id,
    targetWorkId: target.work.id
  });
  const outgoing = repo.listCitations(source.work.id, "outgoing");
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].workId, target.work.id);
  assert.equal(outgoing[0].verified, true);

  const incoming = repo.listCitations(target.work.id, "incoming");
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].workId, source.work.id);
});

test("addCitationEdge rejects provider/relation mismatch (crossref cannot cite)", () => {
  const repo = createRepository();
  const source = repo.resolveWork([{ kind: "doi", value: "10.1/src2" }]);
  const target = repo.resolveWork([{ kind: "doi", value: "10.1/tgt2" }]);
  assert.throws(
    () =>
      repo.addCitationEdge({
        relationType: "cites",
        sourceProvider: "crossref",
        sourceWorkId: source.work.id,
        targetWorkId: target.work.id
      }),
    (error) =>
      error instanceof WorkRepositoryError && error.code === "citation_relation_provider_mismatch"
  );
});

test("deleting a work cascades to identifiers and citation edges", () => {
  const database = createDatabase({ databasePath: ":memory:" });
  const repo = createWorkRepository(database);
  const source = repo.resolveWork([{ kind: "doi", value: "10.1/cascade-src" }]);
  const target = repo.resolveWork([{ kind: "doi", value: "10.1/cascade-tgt" }]);
  repo.addCitationEdge({
    relationType: "cites",
    sourceProvider: "openalex",
    sourceWorkId: source.work.id,
    targetWorkId: target.work.id
  });

  database.prepare("DELETE FROM works WHERE id = ?").run(source.work.id);

  const identifiers = database.prepare(
    "SELECT 1 FROM work_identifiers WHERE work_id = ?"
  ).all(source.work.id);
  const edges = database.prepare(
    "SELECT 1 FROM citation_edges WHERE source_work_id = ? OR target_work_id = ?"
  ).all(source.work.id, source.work.id);
  assert.deepEqual(identifiers, []);
  assert.deepEqual(edges, []);
});
