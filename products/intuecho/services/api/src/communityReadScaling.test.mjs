import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
const actor = { id: "scale-author", name: "Synthetic", initials: "SY" };
const reader = { id: "scale-reader", name: "Synthetic reader", initials: "SR" };
async function fixture(run) {
  const db = new Database(":memory:"); let allowed = true;
  const repository = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationVisibility: async () => allowed, listOrganizations: async () => [{ organizationId: "scale-org", name: "Same display name", role: "member" }] });
  const literature = await repository.confirmRefetchedLiterature(actor, { candidateKey: "crossref:doi:10.1000/read-scale", provider: "crossref", record: { title: "Synthetic scale source", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/read-scale" }], year: 2026 } });
  const base = { body: "Synthetic scale body", visibility: "public", shareToPlaza: true, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
  try { await run({ db, repository, base, revoke: () => { allowed = false; } }); } finally { db.close(); }
}

test("following read does not starve visible results behind 120 inaccessible mutual-only rows", async () => fixture(async ({ db, repository, base }) => {
  const publicAnnotation = await repository.createAnnotation(actor, base);
  db.prepare("UPDATE annotations_v2 SET updated_at = '2025-01-01' WHERE id = ?").run(publicAnnotation.id);
  await repository.toggleFollow(reader.id, actor.id);
  for (let index = 0; index < 120; index += 1) await repository.createAnnotation(actor, { ...base, visibility: "mutual_followers", shareToPlaza: false });
  assert.ok((await repository.followingFeed(reader)).some((item) => item.id === publicAnnotation.id));
}));

test("organization derived feed rechecks current access after stale organization choices", async () => fixture(async ({ repository, base, revoke }) => {
  await repository.createAnnotation(actor, { ...base, visibility: "organization", organizationId: "scale-org", shareToPlaza: false });
  assert.equal((await repository.organizationFeed(reader))[0].annotations.length, 1);
  revoke();
  assert.deepEqual(await repository.organizationFeed(reader), []);
}));

test("latest public cursor traverses every item once across tied timestamps and withdrawal", async () => fixture(async ({ db, repository, base }) => {
  for (let index = 0; index < 7; index += 1) await repository.createAnnotation(actor, base);
  db.prepare("UPDATE annotations_v2 SET created_at = '2026-01-01T00:00:00.000Z'").run();
  let cursor; const ids = [];
  do {
    const page = await repository.plazaPage(reader, { limit: 2, cursor });
    ids.push(...page.annotations.map((item) => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 7); assert.equal(new Set(ids).size, 7);
  await repository.withdraw(ids[0], actor);
  assert.ok(!(await repository.plazaPage(reader, { limit: 20 })).annotations.some((item) => item.id === ids[0]));
}));
