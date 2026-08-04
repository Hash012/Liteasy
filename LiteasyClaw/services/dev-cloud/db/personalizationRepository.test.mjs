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

test("recordSignal paper_opened bumps the work's indexed tags into the user profile", () => {
  const { personalization, tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/profile-tag" }], {
    title: "ColBERT Dense Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });

  const snapshot = personalization.recordSignal("user:u1", {
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
  const work = works.resolveWork([{ kind: "doi", value: "10.1/expose" }], {
    title: "Transformer Attention Mechanism"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.recordSignal("user:u2", {
    kind: "recommendation_saved",
    title: work.work.title,
    workId: work.work.id
  });

  const snapshot = personalization.get("user:u2");
  assert.ok(Array.isArray(snapshot.tags));
  assert.ok(snapshot.tags.length > 0);
  // saved weight (1) > opened weight (0.15)
  assert.ok(snapshot.tags[0].weight >= snapshot.tags[snapshot.tags.length - 1].weight);
});

test("repeated signals increment evidence_count and weight", () => {
  const { personalization, tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/repeat" }], {
    title: "ColBERT Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.recordSignal("user:u3", {
    kind: "paper_opened",
    title: work.work.title,
    workId: work.work.id
  });
  const second = personalization.recordSignal("user:u3", {
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
  const work = works.resolveWork([{ kind: "doi", value: "10.1/clear" }], {
    title: "ColBERT Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  personalization.recordSignal("user:u4", {
    kind: "paper_opened",
    title: work.work.title,
    workId: work.work.id
  });
  const cleared = personalization.clear("user:u4");
  assert.deepEqual(cleared.tags, []);
  assert.equal(cleared.assistantSummary, undefined);
});

test("signal without workId still extracts tags from title (backward compatible)", () => {
  const { personalization } = setup();
  const snapshot = personalization.recordSignal("user:u5", {
    kind: "paper_opened",
    title: "神经信息检索方法"
  });
  assert.ok(snapshot.tags.some((tag) => tag.label === "神经"));
  assert.equal(snapshot.tags[0].tagId, null);
});

test("recordSignal rejects invalid workId silently by ignoring it", () => {
  const { personalization, tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/badid" }], {
    title: "ColBERT Retrieval"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  // workId with illegal chars is ignored; title terms still recorded
  const snapshot = personalization.recordSignal("user:u6", {
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
  assert.throws(
    () => personalization.recordSignal("user:u7", { kind: "paper_opened", title: "   " }),
    (error) => error instanceof PersonalizationValidationError
  );
});
