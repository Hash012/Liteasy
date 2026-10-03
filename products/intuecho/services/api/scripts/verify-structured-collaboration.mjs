import assert from "node:assert/strict";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
export async function verifyStructuredCollaboration(pool) {
  let allowed = true;
  const repository = new PostgresAnnotationCommunityRepository(pool, { authorizeOrganizationVisibility: async () => allowed });
  const host = { id: "structured-host", name: "Synthetic host", initials: "SH" };
  const reader = { id: "structured-reader", name: "Synthetic reader", initials: "SR" };
  const literature = await repository.confirmRefetchedLiterature(host, { candidateKey: "crossref:doi:10.1000/structured-pg", provider: "crossref", record: { title: "Synthetic structured source", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/structured-pg" }], year: 2026 } });
  assert.ok((await repository.readingSources("structured-org", host, "Synthetic structured")).some((item) => item.literatureId === literature.literatureId));
  const base = { body: "Structured pack", visibility: "organization", organizationId: "structured-org", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }], collaboration: { schemaVersion: 1, kind: "reading_pack", sourceRefs: [{ sourceNamespace: "intuecho.literature", sourceId: literature.literatureId, revision: literature.revision }] } };
  const pack = await repository.createAnnotation(host, { ...base, notificationIntent: "reading_task" });
  assert.equal(pack.collaboration.kind, "reading_pack");
  await repository.updateAnnotation(pack.id, host, { expectedRevision: 1, tags: ["Renamed"] });
  assert.equal((await repository.communitySourceRevision(reader, "intuecho.annotation", pack.id, 1)).collaboration.kind, "reading_pack");
  const question = (await repository.createReply(pack.id, reader, { body: "Original question", publishAsAnnotation: false, targets: [], tags: [], collaboration: { schemaVersion: 1, kind: "question", parentPackId: pack.id, sourceRefs: [] } })).reply;
  await repository.updateReply(question.id, reader, { body: "Corrected question", expectedRevision: 1 });
  const summary = { body: "Host synthesis", publishAsAnnotation: false, tags: [], targets: [], collaboration: { schemaVersion: 1, kind: "host_summary", parentPackId: pack.id, sourceRefs: [{ sourceNamespace: "intuecho.reply", sourceId: question.id, revision: 1 }] } };
  await assert.rejects(repository.createReply(pack.id, host, summary), { code: "SOURCE_REVISION_CONFLICT" });
  const historical = await repository.communitySourceRevision(host, "intuecho.reply", question.id, 1);
  assert.equal(historical.body, "Original question"); assert.equal(historical.currentRevision, 2); assert.equal(historical.collaboration.kind, "question");
  summary.collaboration.sourceRefs[0].revision = 2;
  assert.equal((await repository.createReply(pack.id, host, summary)).reply.collaboration.kind, "host_summary");
  await assert.rejects(repository.createReply(pack.id, reader, summary), { code: "HOST_SUMMARY_AUTHOR_REQUIRED" });
  allowed = false;
  await assert.rejects(repository.communitySourceRevision(reader, "intuecho.reply", question.id, 1), { code: "ANNOTATION_NOT_FOUND" });
  return { zeroDataSources: true, typedSemantics: true, actualRevisionChecked: true, historicalAccessRechecked: true };
}
