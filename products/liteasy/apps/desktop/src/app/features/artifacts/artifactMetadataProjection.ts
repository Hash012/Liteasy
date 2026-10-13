import type { ArtifactPaperRef } from "./artifact.types";

type Projection = { issueCount: number; original: unknown };
const projections = new WeakMap<object, Projection>();

export function isArtifactPaperRef(value: unknown): value is ArtifactPaperRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const paper = value as Record<string, unknown>;
  return typeof paper.id === "string" && paper.id.length > 0 && typeof paper.title === "string" &&
    ["arxivId", "doi", "semanticScholarId"].every((key) => paper[key] === undefined || typeof paper[key] === "string") &&
    (paper.year === undefined || typeof paper.year === "string" || (typeof paper.year === "number" && Number.isFinite(paper.year))) &&
    (paper.authors === undefined || typeof paper.authors === "string" ||
      (Array.isArray(paper.authors) && paper.authors.every((author) => typeof author === "string")));
}

// Only the small list metadata is projected. Original records stay reachable and
// no serialized body is rewritten. The array identity follows result -> tab.
export function projectArtifactMetadata<T extends { papers?: unknown; createdAt?: unknown }>(value: T): T & { papers?: ArtifactPaperRef[] } {
  const existing = artifactMetadataIssueCount(value);
  if (existing > 0) return value as T & { papers?: ArtifactPaperRef[] };
  const raw = value.papers;
  const valid = raw === undefined || (Array.isArray(raw) && raw.every(isArtifactPaperRef));
  const invalidDate = value.createdAt !== undefined && typeof value.createdAt !== "string";
  if (valid && !invalidDate) return value as T & { papers?: ArtifactPaperRef[] };
  const papers = Array.isArray(raw) ? raw.filter(isArtifactPaperRef) : [];
  const issueCount = (valid ? 0 : Array.isArray(raw) ? raw.length - papers.length : 1) + Number(invalidDate);
  const projected = { ...value, papers, ...(invalidDate ? { createdAt: undefined } : {}) } as T & { papers?: ArtifactPaperRef[] };
  const protection = { issueCount, original: value };
  projections.set(projected, protection);
  projections.set(papers, protection);
  return projected;
}

export function artifactMetadataIssueCount(value: { papers?: unknown }): number {
  return projections.get(value)?.issueCount ??
    (value.papers && typeof value.papers === "object" ? projections.get(value.papers)?.issueCount : undefined) ?? 0;
}
