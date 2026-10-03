import { collaborationMetadataSchema } from "@intuecho/contracts";
import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

export function collaborationMetadata(value, { actor, visibility, organizationId, parent }) {
  if (value == null) return null;
  const parsed = collaborationMetadataSchema.safeParse(value);
  if (!parsed.success) throw new AnnotationCommunityError("INVALID_COLLABORATION_METADATA");
  const metadata = parsed.data;
  if (visibility !== "organization" || !organizationId) throw new AnnotationCommunityError("INVALID_COLLABORATION_SCOPE");
  if (parent) {
    const parentMetadata = parent.collaboration ?? (parent.collaboration_json ? JSON.parse(parent.collaboration_json) : null);
    if (metadata.kind === "reading_pack" || metadata.parentPackId !== parent.id || parentMetadata?.kind !== "reading_pack") throw new AnnotationCommunityError("INVALID_COLLABORATION_PARENT");
    if (metadata.kind === "host_summary" && parent.author_id !== actor.id) throw new AnnotationCommunityError("HOST_SUMMARY_AUTHOR_REQUIRED", 403);
  } else if (metadata.kind !== "reading_pack") throw new AnnotationCommunityError("INVALID_COLLABORATION_PARENT");
  return metadata;
}
export function assertSourceSnapshot(reference, snapshot, organizationId) {
  if (snapshot.currentRevision !== reference.revision) throw new AnnotationCommunityError("SOURCE_REVISION_CONFLICT", 409);
  if (reference.sourceNamespace !== "intuecho.literature" && snapshot.visibility !== "public" && (snapshot.visibility !== "organization" || snapshot.organizationId !== organizationId)) throw new AnnotationCommunityError("SOURCE_SCOPE_MISMATCH", 403);
}
