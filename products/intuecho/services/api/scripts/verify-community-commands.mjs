import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { communityCommandPayload } from "@intuecho/contracts";
export async function verifyCommunityCommands(repository) {
  const actor = { id: "command-pg-actor", name: "Synthetic command actor", initials: "SC" };
  const literature = await repository.confirmRefetchedLiterature(actor, { candidateKey: "crossref:doi:10.1000/command-pg", provider: "crossref", record: { title: "Command PG fixture", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/command-pg" }], year: 2026 } });
  const base = { body: "Synthetic retry body", visibility: "public", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
  const command = (type, target, input, id = randomUUID()) => ({ ...input, command: { protocolVersion: 1, operationId: id, bodyDigest: createHash("sha256").update(communityCommandPayload(type, target, input)).digest("hex") } });
  const input = command("create_annotation", null, base);
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => repository.createAnnotation(actor, input)));
  assert.equal(new Set(outcomes.map((value) => value.id)).size, 1);
  const annotation = outcomes[0];
  const before = await repository.lookupCommunityCommand(actor, "create_annotation", input.command.operationId);
  assert.equal(before.result.annotation.id, annotation.id);
  assert.deepEqual(await repository.lookupCommunityCommand({ id: "other-pg-actor" }, "create_annotation", input.command.operationId), { status: "not_found" });
  await assert.rejects(repository.createAnnotation(actor, command("create_annotation", null, { ...base, body: "Conflict" }, input.command.operationId)), { code: "COMMAND_PAYLOAD_CONFLICT" });
  const replyInput = command("create_reply", annotation.id, { body: "Synthetic reply", tags: [], targets: [], publishAsAnnotation: false });
  const replies = await Promise.all(Array.from({ length: 4 }, () => repository.createReply(annotation.id, actor, replyInput)));
  assert.equal(new Set(replies.map((value) => value.reply.id)).size, 1);
  await repository.updateAnnotation(annotation.id, actor, { body: "Current annotation", expectedRevision: 1 });
  await assert.rejects(repository.updateAnnotation(annotation.id, actor, { body: "Stale annotation", expectedRevision: 1 }), { code: "ANNOTATION_REVISION_CONFLICT" });
  await repository.updateReply(replies[0].reply.id, actor, { body: "Current reply", expectedRevision: 1 });
  await assert.rejects(repository.updateReply(replies[0].reply.id, actor, { body: "Stale reply", expectedRevision: 1 }), { code: "REPLY_REVISION_CONFLICT" });
  await repository.withdraw(annotation.id, actor);
  assert.equal((await repository.lookupCommunityCommand(actor, "create_annotation", input.command.operationId)).available, false);
  await assert.rejects(repository.createAnnotation(actor, input), { code: "COMMAND_RESULT_UNAVAILABLE" });
  return { concurrentAnnotationReplay: true, concurrentReplyReplay: true, staleEditsRejected: true, noResurrection: true };
}
