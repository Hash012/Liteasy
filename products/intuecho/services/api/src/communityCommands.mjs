import { createHash } from "node:crypto";
import { communityCommandPayload, communityCommandSchema } from "@intuecho/contracts";
import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

export function validateCommunityCommand(type, targetId, input) {
  if (!input.command) return null;
  const parsed = communityCommandSchema.safeParse(input.command);
  if (!parsed.success) throw new AnnotationCommunityError("INVALID_COMMAND");
  const digest = createHash("sha256").update(communityCommandPayload(type, targetId, input)).digest("hex");
  if (digest !== parsed.data.bodyDigest) throw new AnnotationCommunityError("COMMAND_DIGEST_MISMATCH", 409);
  return parsed.data;
}
export function assertCommandReplay(row, command) {
  if (row && row.body_digest !== command.bodyDigest) throw new AnnotationCommunityError("COMMAND_PAYLOAD_CONFLICT", 409);
}
export function commandReceipt(row) {
  return { operationType: row.operation_type, operationId: row.operation_id, bodyDigest: row.body_digest, resourceId: row.resource_id, committedAt: row.committed_at instanceof Date ? row.committed_at.toISOString() : row.committed_at };
}
export function assertExpectedRevision(row, expectedRevision, kind) {
  if (expectedRevision !== undefined && Number(row.revision) !== expectedRevision) throw new AnnotationCommunityError(`${kind}_REVISION_CONFLICT`, 409);
}
