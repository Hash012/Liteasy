import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./database.mjs";
import { createWorkRepository } from "./workRepository.mjs";
import { createTagRepository, extractTags, TagRepositoryError } from "./tagRepository.mjs";

function setup() {
  const database = createDatabase({ databasePath: ":memory:" });
  const works = createWorkRepository(database);
  const tags = createTagRepository(database);
  return { database, tags, works };
}

test("extractTags returns latin terms and chinese bigrams, deduped", () => {
  const result = extractTags("ColBERT: Efficient and Passage-level Representation");
  assert.ok(result.some((tag) => tag.normalized === "colbert"));
  const zh = extractTags("稠密检索与表示学习的方法研究");
  assert.ok(zh.some((tag) => tag.normalized === "稠密"));
  assert.ok(zh.some((tag) => tag.normalized === "检索"));
});

test("indexWork extracts and stores tags, linking to the work", () => {
  const { tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/colbert" }], {
    title: "ColBERT: Efficient Passage-level Representation"
  });
  const result = tags.indexWork(work.work.id, { title: work.work.title });
  assert.ok(result.tags.some((tag) => tag.normalized === "colbert"));

  const workTags = tags.listTagsForWork(work.work.id);
  assert.ok(workTags.some((tag) => tag.normalized === "colbert"));
});

test("indexWork is idempotent on re-index (no duplicate links)", () => {
  const { tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/idem" }], {
    title: "Dense Retrieval Passage Ranking"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  const second = tags.indexWork(work.work.id, { title: work.work.title });
  // Same tag set both times.
  assert.equal(second.tags.length, tags.listTagsForWork(work.work.id).length);
});

test("occurrence_count reflects how many works share a tag", () => {
  const { tags, works } = setup();
  const a = works.resolveWork([{ kind: "doi", value: "10.1/a" }], { title: "ColBERT Retrieval" });
  const b = works.resolveWork([{ kind: "doi", value: "10.1/b" }], { title: "ColBERT Fusion" });
  tags.indexWork(a.work.id, { title: a.work.title });
  tags.indexWork(b.work.id, { title: b.work.title });
  const colbert = tags.getByNormalized("colbert");
  assert.equal(colbert.occurrenceCount, 2);
});

test("abstract text is indexed with lower weight than title", () => {
  const { tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/abs" }], {
    title: "Transformer Attention"
  });
  tags.indexWork(work.work.id, { title: work.work.title, abstract: "attention is all you need" });
  const links = tags.listTagsForWork(work.work.id);
  const attention = links.find((tag) => tag.normalized === "attention");
  assert.ok(attention);
  assert.equal(attention.paperSource, "title"); // appears in title first → title source, weight 1
  // 'need' only appears in abstract
  const need = links.find((tag) => tag.normalized === "need");
  assert.ok(need);
  assert.equal(need.paperSource, "abstract");
  assert.equal(need.weight, 0.6);
});

test("listWorksForTag returns works sharing the tag", () => {
  const { tags, works } = setup();
  const a = works.resolveWork([{ kind: "doi", value: "10.1/r1" }], { title: "ColBERT Retrieval" });
  const b = works.resolveWork([{ kind: "doi", value: "10.1/r2" }], { title: "ColBERT Ranking" });
  tags.indexWork(a.work.id, { title: a.work.title });
  tags.indexWork(b.work.id, { title: b.work.title });
  const colbert = tags.getByNormalized("colbert");
  const worksForTag = tags.listWorksForTag(colbert.id);
  assert.equal(worksForTag.length, 2);
  assert.ok(worksForTag.some((w) => w.id === a.work.id));
});

test("listTags respects minOccurrence filter", () => {
  const { tags, works } = setup();
  const a = works.resolveWork([{ kind: "doi", value: "10.1/m1" }], { title: "ColBERT Retrieval" });
  const b = works.resolveWork([{ kind: "doi", value: "10.1/m2" }], { title: "UniqueWord Ranking" });
  tags.indexWork(a.work.id, { title: a.work.title });
  tags.indexWork(b.work.id, { title: b.work.title });
  // 'colbert' appears in 1 work only; 'ranking' appears in both (m1 'Ranking'? no — m1 is 'Retrieval')
  const all = tags.listTags({ minOccurrence: 0 });
  assert.ok(all.length > 0);
  const high = tags.listTags({ minOccurrence: 2 });
  assert.ok(high.every((tag) => tag.occurrenceCount >= 2));
});

test("deleting a work cascades to paper_tags", () => {
  const { database, tags, works } = setup();
  const work = works.resolveWork([{ kind: "doi", value: "10.1/cascade" }], {
    title: "ColBERT Cascade"
  });
  tags.indexWork(work.work.id, { title: work.work.title });
  const colbert = tags.getByNormalized("colbert");
  assert.equal(colbert.occurrenceCount, 1);

  database.prepare("DELETE FROM works WHERE id = ?").run(work.work.id);
  const links = database.prepare("SELECT 1 FROM paper_tags WHERE work_id = ?").all(work.work.id);
  assert.deepEqual(links, []);
});

test("indexWork throws for missing work id", () => {
  const { tags } = setup();
  assert.throws(
    () => tags.indexWork("   ", { title: "Anything" }),
    (error) => error instanceof TagRepositoryError && error.code === "invalid_work_id"
  );
});
