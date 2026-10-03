import assert from "node:assert/strict";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";

export const departedOrganizationFixture = {
  organizationId: "departure-org",
  author: { id: "departure-author", name: "Synthetic author", initials: "SA" },
  replyAuthor: { id: "departure-reply-author", name: "Synthetic participant", initials: "SP" },
  member: { id: "departure-member", name: "Synthetic member", initials: "SM" },
  admin: { id: "departure-admin", name: "Synthetic admin", initials: "SD" },
  outsider: { id: "departure-outsider", name: "Synthetic outsider", initials: "SO" }
};

export async function verifyDepartedOrganizationRights(repository, revoke) {
  const { organizationId, author, replyAuthor, member, admin, outsider } = departedOrganizationFixture;
  const literature = await repository.confirmRefetchedLiterature(author, { candidateKey: "crossref:doi:10.1000/departure-matrix", provider: "crossref", record: { title: "Synthetic departure matrix", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/departure-matrix" }], year: 2026 } });
  const target = { kind: "whole_document", literature: { literatureId: literature.literatureId } };
  const parent = await repository.createAnnotation(author, { body: "Original organization parent", visibility: "organization", organizationId, shareToPlaza: false, tags: [], targets: [target] });
  const created = await repository.createReply(parent.id, replyAuthor, { body: "Original participant reply", publishAsAnnotation: true, tags: [], targets: [target] });
  const reply = created.reply; const projection = created.annotation;
  await repository.updateAnnotation(parent.id, author, { body: "Current organization parent", expectedRevision: 1 });
  await repository.updateReply(reply.id, replyAuthor, { body: "Current participant reply", expectedRevision: 1 });
  for (const viewer of [author, replyAuthor, member, admin]) {
    assert.equal((await repository.annotation(parent.id, viewer)).body, "Current organization parent");
    assert.equal((await repository.replies(parent.id, viewer))[0].body, "Current participant reply");
    assert.equal((await repository.annotation(projection.id, viewer)).body, "Current participant reply");
    assert.equal((await repository.communitySourceRevision(viewer, "intuecho.reply", reply.id, 1)).body, "Original participant reply");
  }
  await assert.rejects(repository.annotation(parent.id, outsider), { code: "ANNOTATION_NOT_FOUND" });
  revoke();
  const observed = [];
  for (const [role, viewer] of Object.entries({ author, replyAuthor, member, admin, outsider })) {
    const rootAuthor = role === "author";
    const projectionReader = rootAuthor || role === "replyAuthor";
    const reads = [
      ["parent", () => repository.annotation(parent.id, viewer), rootAuthor],
      ["replies", () => repository.replies(parent.id, viewer), rootAuthor],
      ["parent_history", () => repository.communitySourceRevision(viewer, "intuecho.annotation", parent.id, 1), rootAuthor],
      ["reply_history", () => repository.communitySourceRevision(viewer, "intuecho.reply", reply.id, 1), rootAuthor],
      ["projection", () => repository.annotation(projection.id, viewer), projectionReader],
      ["projection_history", () => repository.communitySourceRevision(viewer, "intuecho.annotation", projection.id, 1), projectionReader]
    ];
    for (const [resource, read, expected] of reads) {
      if (expected) assert.ok(await read());
      else await assert.rejects(read(), { code: "ANNOTATION_NOT_FOUND" });
      observed.push({ role, resource, allowed: expected });
    }
  }
  await assert.rejects(repository.updateAnnotation(parent.id, author, { body: "Forbidden departed edit", expectedRevision: 2 }), { code: "ORGANIZATION_ACCESS_DENIED" });
  await assert.rejects(repository.updateReply(reply.id, replyAuthor, { body: "Forbidden departed reply edit", expectedRevision: 2 }), { code: "ORGANIZATION_ACCESS_DENIED" });
  await assert.rejects(repository.updateReplyPublication(reply.id, replyAuthor, { published: true, tags: [], targets: [target], expectedRevision: 2 }), { code: "ORGANIZATION_ACCESS_DENIED" });
  await assert.rejects(repository.createReply(parent.id, author, { body: "Forbidden new reply", publishAsAnnotation: false, tags: [], targets: [] }), { code: "ORGANIZATION_ACCESS_DENIED" });
  await assert.rejects(repository.moderateOrganizationAnnotation({ annotationId: parent.id, userId: admin.id, action: "withdraw", reason: "Synthetic denied departed moderation", traceId: "departure-admin-denied" }), { code: "ORGANIZATION_MODERATION_DENIED" });
  await assert.rejects(async () => repository.withdraw(projection.id, author), { code: "NOT_ANNOTATION_AUTHOR" });
  await assert.rejects(async () => repository.withdraw(parent.id, outsider), { code: "NOT_ANNOTATION_AUTHOR" });
  await repository.deleteReply(reply.id, replyAuthor);
  await assert.rejects(repository.communitySourceRevision(author, "intuecho.reply", reply.id, 1), { code: "SOURCE_NOT_FOUND" });
  await repository.withdraw(parent.id, author);
  await assert.rejects(repository.annotation(parent.id, author), { code: "ANNOTATION_NOT_FOUND" });
  return { fixtureVersion: "departed-organization-rights-v1", observedReads: observed, departedWritesDenied: true, authorDeleteException: true, noPolicyExpansion: true };
}

export async function verifyPostgresDepartedOrganizationRights(pool) {
  let active = true;
  const members = new Set(Object.values(departedOrganizationFixture).filter((value) => value?.id && value.id !== departedOrganizationFixture.outsider.id).map((value) => value.id));
  const access = ({ organizationId, userId }) => organizationId === departedOrganizationFixture.organizationId && active && members.has(userId);
  const repository = new PostgresAnnotationCommunityRepository(pool, {
    authorizeOrganizationVisibility: async (input) => access(input),
    authorizeOrganizationAccess: async (input) => ({ allowed: access(input), role: input.userId === departedOrganizationFixture.admin.id ? "admin" : "member" })
  });
  return verifyDepartedOrganizationRights(repository, () => { active = false; });
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const { default: pg } = await import("pg");
  const { validateIntuechoPostgresIntegrationDatabases } = await import("./postgresIntegrationGuard.mjs");
  const { verifyIntuechoMigrations } = await import("../src/migrations.mjs");
  const { application } = validateIntuechoPostgresIntegrationDatabases(process.env.INTUECHO_TEST_DATABASE_URL, process.env.INTUECHO_TEST_MIGRATION_DATABASE_URL);
  const pool = new pg.Pool({ ...application, max: 4, ssl: false });
  try {
    await verifyIntuechoMigrations(pool);
    process.stdout.write(`${JSON.stringify(await verifyPostgresDepartedOrganizationRights(pool))}\n`);
  } finally { await pool.end(); }
}
