import { bibliographicDate } from "../paper-services/bibliographicMetadata";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import type { LiteratureAuthorityClient } from "../paper-identity/literatureAuthorityClient";
import type { RecommendationItem } from "./recommendation.types";

export function recommendationDateLabel(item: RecommendationItem) {
  const date = bibliographicDate(item.publishedAt);
  if (date) return date.slice(0, 7);
  return Number.isInteger(item.publishedYear) && item.publishedYear! >= 1000 && item.publishedYear! <= 9999
    ? String(item.publishedYear) : "日期未知";
}

export function recommendationSourceUrl(item: RecommendationItem) {
  const identifier = recommendationIdentifier(item)?.[0];
  const value = item.sourceUrl || (identifier ? identifier.kind === "doi" ? `https://doi.org/${identifier.value}` : `https://arxiv.org/abs/${identifier.value}` : undefined);
  if (!value) return undefined;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}

function recommendationIdentifier(item: RecommendationItem) {
  const raw = item.canonicalId ?? item.id;
  const doi = normalizeLiteratureIdentifier("doi", item.identityResolution?.doi ?? raw.replace(/^doi:/i, ""));
  if (/^10\.48550\/arxiv\./i.test(doi)) return [{ kind: "arxiv_id" as const, value: doi.replace(/^10\.48550\/arxiv\./i, "") }];
  if (doi) return [{ kind: "doi" as const, value: doi }];
  const arxiv = normalizeLiteratureIdentifier("arxiv_id", item.identityResolution?.arxivId ?? raw.replace(/^arxiv:/i, ""));
  if (arxiv) return [{ kind: "arxiv_id" as const, value: arxiv }];
  return undefined;
}

/** Fetch only an exact identifier, never substitute a similar title for the selected paper. */
export async function loadRecommendationMetadata(item: RecommendationItem, client: LiteratureAuthorityClient) {
  const identifiers = recommendationIdentifier(item);
  if (!identifiers) return { item, message: "展示已获取的题录；可打开论文网站查看完整信息。" };
  const result = await client.resolveLiterature({ purpose: "liteasy_pdf_annotation", hints: { identifiers } });
  if (result.status !== "exact" || !result.candidate.record.identifiers.some((found) =>
    identifiers.some((expected) => found.kind === expected.kind && (found.value.toLowerCase() === expected.value.toLowerCase() ||
      (expected.kind === "arxiv_id" && !/v\d+$/.test(expected.value) && found.value.replace(/v\d+$/, "") === expected.value))))) {
    return { item, message: "来源未返回此论文的完整题录，已保留原信息。" };
  }
  const record = result.candidate.record;
  const arxiv = record.identifiers.find((id) => id.kind === "arxiv_id");
  return { item: { ...item, title: record.title || item.title,
    ...(result.candidate.provider === "arxiv" && arxiv ? { openAccessAvailable: true, openAccessPdfUrl: `https://arxiv.org/pdf/${arxiv.value}` } : {}),
    authors: record.authors?.length ? record.authors : item.authors,
    abstract: record.abstract || item.abstract, venue: record.venue || item.venue,
    subjects: record.subjects?.length ? record.subjects : item.subjects,
    keywords: record.keywords?.length ? record.keywords : item.keywords,
    publishedYear: record.year ?? item.publishedYear, publishedAt: record.publishedAt || item.publishedAt,
  }, message: "题录已更新。" };
}

export type RecommendationSort = "recommended" | "newest" | "citations";
export function filterRecommendations(items: RecommendationItem[], query: string, access: boolean, year: string, sort: RecommendationSort) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = items.filter((item) => (!access || item.openAccessAvailable || item.openAccessPdfUrl) &&
    (!year || recommendationDateLabel(item).slice(0, 4) === year) && terms.every((term) =>
      [item.title, ...(item.authors ?? []), item.venue, ...(item.subjects ?? []), ...(item.keywords ?? []), item.abstract]
        .filter(Boolean).join(" ").toLocaleLowerCase().includes(term)));
  if (sort === "newest") result.sort((a, b) => {
    const date = (item: RecommendationItem) => recommendationDateLabel(item) === "日期未知" ? "" : recommendationDateLabel(item);
    return date(b).localeCompare(date(a));
  });
  if (sort === "citations") result.sort((a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1));
  return result;
}
