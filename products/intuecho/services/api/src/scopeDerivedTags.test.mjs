import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";

import { verifyScopeDerivedTags } from "../scripts/verify-scope-derived-tags.mjs";

test("real SQLite derived tags exclude private, organization and mutual samples from public output", async () => {
  const db = new Database(":memory:");
  try {
    await verifyScopeDerivedTags(new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationVisibility: async () => true }));
  } finally { db.close(); }
});

test("legacy unscoped platform labels remain stored for review but cannot influence public output or search", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const author = { id: "legacy-scope-author", name: "Synthetic", initials: "SY" };
    const literature = await repository.confirmRefetchedLiterature(author, { candidateKey: "crossref:doi:10.1000/legacy-scope", provider: "crossref", record: { title: "Plain source", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/legacy-scope" }], year: 2026 } });
    const annotation = await repository.createAnnotation(author, { body: "Plain body", visibility: "public", shareToPlaza: true, tags: ["kept"], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] });
    db.prepare("INSERT INTO annotation_tags_v2(annotation_id, tag_slug, tag_name, origin, state, classifier_version, assigned_at, updated_at) VALUES (?, '旧密标', '旧密标', 'platform', 'active', 'local-semantic-v1', '2026-01-01', '2026-01-01')").run(annotation.id);
    assert.deepEqual((await repository.annotation(annotation.id, null)).tags.map((tag) => tag.name), ["kept"]);
    assert.equal((await repository.plaza(null, { query: "旧密标" })).length, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM annotation_tags_v2 WHERE origin='platform'").get().n, 1);
  } finally { db.close(); }
});
