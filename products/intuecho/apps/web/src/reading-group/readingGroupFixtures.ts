import type { CommunityAnnotation, CommunityReply } from "../community.types";

export function annotationFixture(overrides: Partial<CommunityAnnotation> = {}): CommunityAnnotation {
  return {
    author: { id: "host_1", name: "Synthetic host", initials: "SH", profile: { educationStage: null, institutions: [] } },
    body: "# Synthetic reading pack\n\nRead and compare", createdAt: "2026-10-03T00:00:00.000Z",
    id: "pack_1", organizationId: "org_x", originalReply: null, ratingAverage: null, ratingCount: 0,
    revision: 2, shareToPlaza: false,
    tags: [{ confidence: null, name: "读书包", origin: "user", state: "active" }],
    targets: [{ kind: "whole_document", literature: { literatureId: "literature_1" } }],
    updatedAt: "2026-10-03T00:00:00.000Z", viewerCanModerate: false,
    viewerIsAuthor: false, viewerSaved: false, viewerRating: null, visibility: "organization", withdrawnAt: null,
    ...overrides
  };
}

export function replyFixture(overrides: Partial<CommunityReply> = {}): CommunityReply {
  return {
    author: { ...annotationFixture().author, id: "member_1", name: "Synthetic contributor" },
    body: "PRIVATE_REPLY_BODY", createdAt: "2026-10-03T01:00:00.000Z", derivedAnnotationId: null,
    derivedAnnotationState: "none", id: "reply_1", parentAnnotationId: "pack_1", revision: 1,
    updatedAt: "2026-10-03T01:00:00.000Z", viewerIsAuthor: false, ...overrides
  };
}
