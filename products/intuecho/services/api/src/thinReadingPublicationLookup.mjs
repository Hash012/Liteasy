import { createHash } from "node:crypto";
import { thinReadingSyncPayload } from "@intuecho/contracts";

// A lookup proves an exact stored original; absence is never proof that an
// in-flight create cannot still commit. It performs no publication operation.
export function thinReadingPublicationLookup(query, row) {
  const identity = { annotationId: query.annotationId, queueKey: query.queueKey };
  if (!row || row.withdrawn_at) return { ...identity, status: "not_found" };
  if (row.source_annotation_id !== query.annotationId ||
      Date.parse(row.source_updated_at) !== Date.parse(query.updatedAt) ||
      (row.publication_annotation_id && (row.publication_annotation_id !== row.annotation_id || row.publication_source_id !== query.annotationId))) {
    return { ...identity, status: "conflict" };
  }
  const targets = row.targets.map(({ target, literatureId }) => ({ ...target, literature: { literatureId } }));
  const digest = createHash("sha256").update(thinReadingSyncPayload({ body: row.body, targets })).digest("hex");
  if (digest !== query.payloadDigest) return { ...identity, status: "conflict" };
  return { ...query, status: "matched", remoteAnnotationId: row.annotation_id, publicationRevision: Number(row.source_revision ?? 1) };
}
