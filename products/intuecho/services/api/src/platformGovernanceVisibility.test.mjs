import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";

function fixture() {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationAccess: async () => ({ allowed: true, role: "admin" }), authorizeOrganizationVisibility: async () => true });
  function insert(id, visibility) {
    db.prepare("INSERT INTO annotations_v2(id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES (?, ?, 'author', 'Synthetic author', 'SA', '{}', ?, ?, 0, 1, ?, ?)").run(id, `Private material ${id}`, visibility, visibility === "organization" ? "org-test" : null, "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
    db.prepare("INSERT INTO annotation_tags_v2(annotation_id, tag_slug, tag_name, origin, state, confidence, classifier_version, assigned_at, updated_at) VALUES (?, 'label', 'Label', 'platform', 'active', 0.8, 'synthetic', ?, ?)").run(id, "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
  }
  return { db, repository, insert };
}

test("platform annotation and appeal lists cannot disclose nonpublic material while author and organization paths remain", async () => {
  const { db, repository, insert } = fixture();
  try {
    const appeals = [];
    for (const visibility of ["private", "organization", "mutual_followers", "public"]) {
      insert(visibility, visibility);
      appeals.push(repository.appealPlatformTag(visibility, "label", "author", `Private appeal material for ${visibility}`));
      assert.equal((await repository.annotation(visibility, { id: "author" })).body, `Private material ${visibility}`);
    }
    assert.deepEqual(repository.listAdminAnnotations().map((item) => item.id), ["public"]);
    assert.deepEqual(repository.listTagAppeals().map((item) => item.annotationId), ["public"]);
    for (const appeal of appeals.slice(0, 3)) assert.throws(() => repository.resolveTagAppeal(appeal.appealId, "admin", { decision: "accepted", reason: "No access to private material." }, "trace"), (error) => error.code === "TAG_APPEAL_NOT_FOUND");
    await repository.moderateOrganizationAnnotation({ annotationId: "organization", userId: "org-admin", action: "withdraw", reason: "Existing organization authority.", traceId: "trace-org" });
    repository.moderateAnnotation({ annotationId: "private", adminId: "platform-admin", action: "withdraw", reason: "Existing platform change authority.", traceId: "trace-platform" });
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_moderation_audit_v2").get().count, 2);
  } finally { db.close(); }
});

test("unknown historical appeal material remains redacted until the author explicitly resubmits", () => {
  const { db, repository, insert } = fixture();
  try {
    insert("legacy", "public");
    db.prepare("UPDATE annotation_tags_v2 SET state = 'appealed' WHERE annotation_id = 'legacy'").run();
    db.prepare("INSERT INTO annotation_tag_appeals_v2(id, annotation_id, tag_slug, submitted_by, reason, status, created_at) VALUES ('legacy-appeal', 'legacy', 'label', 'author', 'Private historical appeal material', 'pending', '2026-01-01')").run();
    const listed = repository.listTagAppeals()[0];
    assert.equal(listed.appealId, "legacy-appeal");
    assert.equal(listed.detailsAvailable, false);
    assert.equal(listed.annotationBody, "");
    assert.equal(listed.reason, "");
    assert.equal(listed.submittedBy, "");
    assert.throws(() => repository.resolveTagAppeal("legacy-appeal", "admin", { decision: "accepted", reason: "Must not infer consent." }, "trace"), (error) => error.code === "TAG_APPEAL_NOT_FOUND");
    assert.equal(repository.appealPlatformTag("legacy", "label", "author", "New material explicitly submitted for this public annotation.").appealId, "legacy-appeal");
    assert.equal(repository.listTagAppeals()[0].detailsAvailable, true);
    assert.equal(repository.listTagAppeals()[0].submittedRevision, 1);
  } finally { db.close(); }
});

test("publishing a formerly private annotation does not publish its earlier appeal material", () => {
  const { db, repository, insert } = fixture();
  try {
    insert("later-public", "private");
    const appeal = repository.appealPlatformTag("later-public", "label", "author", "The appeal was sent while the content was private.");
    db.prepare("UPDATE annotations_v2 SET visibility = 'public', revision = 2 WHERE id = 'later-public'").run();
    assert.deepEqual(repository.listTagAppeals(), []);
    assert.throws(() => repository.resolveTagAppeal(appeal.appealId, "admin", { decision: "accepted", reason: "Cannot disclose old private reason." }, "trace"), (error) => error.code === "TAG_APPEAL_NOT_FOUND");
    repository.appealPlatformTag("later-public", "label", "author", "A newly submitted public appeal contains only this intended reason.");
    assert.equal(repository.listTagAppeals()[0].submittedRevision, 2);
    assert.equal(repository.listTagAppeals()[0].reason.includes("newly submitted"), true);
  } finally { db.close(); }
});
