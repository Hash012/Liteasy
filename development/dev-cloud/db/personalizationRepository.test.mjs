import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./database.mjs";
import { createWorkRepository } from "./workRepository.mjs";
import { createTagRepository } from "./tagRepository.mjs";
import {
  createPersonalizationRepository,
  PersonalizationValidationError
} from "./personalizationRepository.mjs";

function setup() {
  const database = createDatabase({ databasePath: ":memory:" });
  const works = createWorkRepository(database);
  const tags = createTagRepository(database);
  const personalization = createPersonalizationRepository(database);
  return { database, personalization, tags, works };
}

test("new accounts require explicit opt-in before behavior collection", () => {
  const { database, personalization } = setup();
  const ownerKey = "user:explicit-opt-in";

  assert.equal(personalization.get(ownerKey).enabled, false);
  assert.deepEqual(personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: "Private retrieval topic"
  }).tags, []);
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM personalization_terms WHERE owner_key = ?")
      .get(ownerKey).count,
    0
  );
});

test("recordSignal paper_opened bumps the work's indexed tags into the user profile", () => {
  const { personalization, tags, works } = setup();
  const ownerKey = "user:u1";
  const work = works.resolveWork([{ kind: "doi", value: "10.1/profile-tag" }], {
    title: "ColBERT Dense Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.setEnabled(ownerKey, true);

  const snapshot = personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: work.work.title,
    workId: work.work.id
  });

  const colbert = snapshot.tags.find((tag) => tag.label === "colbert");
  assert.ok(colbert, "colbert tag should be in profile");
  assert.equal(colbert.tagId, tags.getByNormalized("colbert").id);
  assert.equal(colbert.signalSource, "paper_opened");
  assert.ok(colbert.evidenceCount >= 1);
});

test("profile/get exposes top tags ordered by weight and evidence", () => {
  const { personalization, tags, works } = setup();
  const ownerKey = "user:u2";
  const work = works.resolveWork([{ kind: "doi", value: "10.1/expose" }], {
    title: "Transformer Attention Mechanism"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.setEnabled(ownerKey, true);
  personalization.recordSignal(ownerKey, {
    kind: "recommendation_saved",
    title: work.work.title,
    workId: work.work.id
  });

  const snapshot = personalization.get(ownerKey);
  assert.ok(Array.isArray(snapshot.tags));
  assert.ok(snapshot.tags.length > 0);
  // saved weight (1) > opened weight (0.15)
  assert.ok(snapshot.tags[0].weight >= snapshot.tags[snapshot.tags.length - 1].weight);
});

test("repeated signals increment evidence_count and weight", () => {
  const { personalization, tags, works } = setup();
  const ownerKey = "user:u3";
  const work = works.resolveWork([{ kind: "doi", value: "10.1/repeat" }], {
    title: "ColBERT Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.setEnabled(ownerKey, true);
  personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: work.work.title,
    workId: work.work.id
  });
  const second = personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: work.work.title,
    workId: work.work.id
  });
  const colbert = second.tags.find((tag) => tag.label === "colbert");
  assert.equal(colbert.evidenceCount, 2);
  assert.ok(colbert.weight > 0.15); // 0.15 + 0.15 = 0.3
});

test("clear profile removes user tags and terms", () => {
  const { personalization, tags, works } = setup();
  const ownerKey = "user:u4";
  const work = works.resolveWork([{ kind: "doi", value: "10.1/clear" }], {
    title: "ColBERT Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.setEnabled(ownerKey, true);
  personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: work.work.title,
    workId: work.work.id
  });
  const cleared = personalization.clear(ownerKey);
  assert.deepEqual(cleared.tags, []);
  assert.equal(cleared.assistantSummary, undefined);
});

test("clear removes every personalization surface, disables collection, and invalidates old versions", () => {
  const { database, personalization } = setup();
  const ownerKey = "user:privacy-clear";
  const timestamp = "2026-08-06T00:00:00.000Z";
  personalization.setEnabled(ownerKey, true);
  personalization.save(ownerKey, { disciplines: [], stage: "博士研究生" });
  personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: "Private Retrieval Topic"
  });
  personalization.recordSignal(ownerKey, {
    kind: "recommendation_dismissed",
    recommendationId: "recommendation-1"
  });
  personalization.syncLocalManifest(ownerKey, [{
    contentHash: "a".repeat(64),
    syncDocumentId: "local-private-paper",
    title: "Private Paper"
  }]);
  database.prepare(`
    INSERT INTO recommendation_candidates (
      owner_key, canonical_id, status, last_discovered_at, document_json
    ) VALUES (?, 'candidate-1', 'candidate', ?, '{}')
  `).run(ownerKey, timestamp);
  database.prepare(`
    INSERT INTO recommendation_feedback (
      owner_key, feedback_key, canonical_id, action, created_at
    ) VALUES (?, 'feedback-1', 'candidate-1', 'saved', ?)
  `).run(ownerKey, timestamp);
  database.prepare(`
    INSERT INTO recommendation_cache_entries (
      owner_key, scope_key, recommendations_json, cached_at, expires_at
    ) VALUES (?, 'old-scope', '[]', ?, '2027-01-01T00:00:00.000Z')
  `).run(ownerKey, timestamp);

  const oldVersion = personalization.get(ownerKey).personalizationVersion;
  const cleared = personalization.clear(ownerKey);
  const tables = [
    "academic_profiles",
    "local_library_manifest_entries",
    "personalization_terms",
    "recommendation_cache_entries",
    "recommendation_candidates",
    "recommendation_feedback",
    "recommendation_suppressions"
  ];
  for (const table of tables) {
    assert.equal(
      database.prepare(`SELECT count(*) AS count FROM ${table} WHERE owner_key = ?`).get(ownerKey).count,
      0,
      `${table} should be empty after clear`
    );
  }
  assert.equal(cleared.enabled, false);
  assert.ok(cleared.personalizationVersion > oldVersion);
  assert.equal(personalization.getRecommendationPreferences(ownerKey).enabled, false);
  assert.deepEqual(personalization.syncLocalManifest(ownerKey, [{
    syncDocumentId: "should-not-write",
    title: "Should not write"
  }]).disabled, true);

  const clearedAgain = personalization.clear(ownerKey);
  assert.equal(clearedAgain.cleared, true);
  assert.ok(clearedAgain.personalizationVersion > cleared.personalizationVersion);
});

test("signal without workId still extracts tags from title (backward compatible)", () => {
  const { personalization } = setup();
  const ownerKey = "user:u5";
  personalization.setEnabled(ownerKey, true);
  const snapshot = personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: "神经信息检索方法"
  });
  assert.ok(snapshot.tags.some((tag) => tag.label === "神经"));
  assert.equal(snapshot.tags[0].tagId, null);
});

test("recordSignal rejects invalid workId silently by ignoring it", () => {
  const { personalization, tags, works } = setup();
  const ownerKey = "user:u6";
  const work = works.resolveWork([{ kind: "doi", value: "10.1/badid" }], {
    title: "ColBERT Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.setEnabled(ownerKey, true);
  // workId with illegal chars is ignored; title terms still recorded
  const snapshot = personalization.recordSignal(ownerKey, {
    kind: "paper_opened",
    title: "ColBERT Retrieval",
    workId: "bad id with spaces"
  });
  assert.ok(snapshot.tags.length > 0);
  // colbert from title only, no tagId link (work tag not bumped due to invalid id)
  const colbert = snapshot.tags.find((tag) => tag.label === "colbert");
  assert.equal(colbert.tagId, null);
});

test("recordSignal rejects missing title for paper_opened", () => {
  const { personalization } = setup();
  const ownerKey = "user:u7";
  personalization.setEnabled(ownerKey, true);
  assert.throws(
    () => personalization.recordSignal(ownerKey, { kind: "paper_opened", title: "   " }),
    (error) => error instanceof PersonalizationValidationError
  );
});
