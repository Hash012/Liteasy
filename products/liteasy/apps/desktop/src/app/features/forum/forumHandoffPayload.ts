import type { ForumAnnotationTarget, ForumContext, ForumDraftUpdate } from "./forum.types";

function evidencePayload(target: Extract<ForumAnnotationTarget, { kind: "source_passage" }> | Extract<ForumAnnotationTarget, { kind: "derived_passage" }>["evidence"][number]) {
  return {
    anchorHash: target.anchorHash,
    excerpt: target.excerpt,
    literature: { literatureId: target.literature.literatureId },
    ...(target.page === undefined ? {} : { page: target.page }),
    rects: target.rects.map(({ left, top, width, height }) => ({ left, top, width, height }))
  };
}

/** Project the same public fields for preview and handoff; never serialize a local asset. */
export function forumHandoffPayload(context: ForumContext, update?: ForumDraftUpdate) {
  if (!context.visibility || !["private", "organization", "mutual_followers", "public"].includes(context.visibility)) {
    throw new Error("请先选择接收范围，再交接到 Intuecho。");
  }
  if (context.visibility === "organization" && !context.organizationId?.trim()) {
    throw new Error("请先选择接收组织。");
  }
  if (context.visibility !== "public" && context.shareToPlaza) {
    throw new Error("只有公开批注可以发布到广场。");
  }
  return {
    body: update?.body ?? context.body ?? "",
    ...(context.visibility === "organization" ? { organizationId: context.organizationId } : {}),
    shareToPlaza: context.shareToPlaza ?? false,
    tags: [...(update?.tags ?? context.tags ?? [])],
    targets: context.targets.map((target) => {
      if (target.kind === "whole_document") return { kind: target.kind, literature: { literatureId: target.literature.literatureId } };
      if (target.kind === "source_passage") return { kind: target.kind, ...evidencePayload(target) };
      return {
        kind: target.kind,
        literature: { literatureId: target.literature.literatureId },
        derivedContent: {
          artifactId: target.derivedContent.artifactId,
          excerpt: target.derivedContent.excerpt,
          ...(target.derivedContent.nodeId === undefined ? {} : { nodeId: target.derivedContent.nodeId }),
          version: target.derivedContent.version
        },
        evidence: target.evidence.map(evidencePayload)
      };
    }),
    visibility: context.visibility
  };
}
