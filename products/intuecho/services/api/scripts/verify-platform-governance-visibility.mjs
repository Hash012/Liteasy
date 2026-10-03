import assert from "node:assert/strict";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";

export async function verifyPlatformGovernanceVisibility({ pool, literatureId }) {
  const author = { id: "platform-privacy-fixture-author", name: "Synthetic privacy author", initials: "PA" };
  const repository = new PostgresAnnotationCommunityRepository(pool, {
    authorizeOrganizationAccess: async () => ({ allowed: true, role: "admin" }),
    authorizeOrganizationVisibility: async () => true
  });
  const tagId = "tag-platform-privacy-fixture";
  await pool.query("INSERT INTO tags(id, slug, name) VALUES ($1, 'platform-privacy-fixture', 'Synthetic privacy label')", [tagId]);
  const cases = [];
  for (const visibility of ["private", "organization", "mutual_followers", "public"]) {
    const annotation = await repository.createAnnotation(author, { body: `Synthetic ${visibility} body for governance boundary.`, organizationId: visibility === "organization" ? "org-privacy-fixture" : undefined, visibility, shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId } }] });
    await pool.query("INSERT INTO annotation_tags(annotation_id, tag_id, origin, state) VALUES ($1, $2, 'platform', 'active')", [annotation.id, tagId]);
    const appeal = await repository.appealPlatformTag(annotation.id, "platform-privacy-fixture", author.id, `Synthetic ${visibility} appeal reason.`);
    cases.push({ annotation, appeal });
    assert.equal((await repository.annotation(annotation.id, author)).body, annotation.body);
  }
  const annotationList = await repository.listAdminAnnotations();
  const appealList = await repository.listTagAppeals();
  for (const item of cases.slice(0, 3)) {
    assert.equal(annotationList.some((row) => row.id === item.annotation.id), false);
    assert.equal(appealList.some((row) => row.appealId === item.appeal.appealId), false);
    await assert.rejects(repository.resolveTagAppeal(item.appeal.appealId, "platform-admin", { decision: "accepted", reason: "Must not access nonpublic appeal material." }, "trace-private"), (error) => error.code === "TAG_APPEAL_NOT_FOUND");
  }
  assert.equal(annotationList.some((row) => row.id === cases[3].annotation.id), true);
  assert.equal(appealList.find((row) => row.appealId === cases[3].appeal.appealId).detailsAvailable, true);

  const legacy = cases[3];
  await pool.query("UPDATE annotation_tag_appeals SET submitted_visibility = NULL, submitted_organization_id = NULL, submitted_revision = NULL WHERE id = $1", [legacy.appeal.appealId]);
  const redacted = (await repository.listTagAppeals()).find((row) => row.appealId === legacy.appeal.appealId);
  assert.equal(redacted.detailsAvailable, false);
  assert.equal(redacted.reason, "");
  assert.equal(redacted.annotationBody, "");
  assert.equal(redacted.submittedBy, "");
  await assert.rejects(repository.resolveTagAppeal(legacy.appeal.appealId, "platform-admin", { decision: "accepted", reason: "Historical audience unknown." }, "trace-legacy"), (error) => error.code === "TAG_APPEAL_NOT_FOUND");
  const resubmitted = await repository.appealPlatformTag(legacy.annotation.id, "platform-privacy-fixture", author.id, "New public material explicitly resubmitted by the author.");
  assert.equal(resubmitted.appealId, legacy.appeal.appealId);
  assert.equal((await repository.listTagAppeals()).find((row) => row.appealId === legacy.appeal.appealId).detailsAvailable, true);
  await repository.resolveTagAppeal(legacy.appeal.appealId, "platform-admin", { decision: "accepted", reason: "Fresh material reviewed under its public audience." }, "trace-public");

  await repository.updateAnnotation(cases[0].annotation.id, author, { visibility: "public" });
  assert.equal((await repository.listTagAppeals()).some((row) => row.appealId === cases[0].appeal.appealId), false);
  await repository.appealPlatformTag(cases[0].annotation.id, "platform-privacy-fixture", author.id, "Public resubmission intentionally replaces the old private material.");
  assert.equal((await repository.listTagAppeals()).find((row) => row.appealId === cases[0].appeal.appealId).submittedRevision, 2);
  return { publicListsOnly: true, historicalAppealsRedacted: true, authorResubmission: true };
}
