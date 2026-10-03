import type { CommunitySourceReference } from "@intuecho/contracts";
import type { PaperIdentity, PlazaFilters } from "./community.types";

export const plazaFilterFields = ["query", "institution", "educationStage", "documentType", "literatureId", "literatureIdentityKind", "literatureIdentityValue", "sort", "limit"] as const;
export function plazaFiltersFromLocation(): PlazaFilters | null {
  const params = new URLSearchParams(window.location.search);
  if (!plazaFilterFields.some((field) => params.has(field))) return null;
  const result: PlazaFilters = { sort: params.get("sort") === "latest" ? "latest" : "recommended" };
  for (const field of ["query", "institution", "educationStage", "documentType", "literatureId", "literatureIdentityValue"] as const) {
    if (params.get(field)) result[field] = params.get(field)!;
  }
  const kind = params.get("literatureIdentityKind") as PaperIdentity["kind"] | null;
  if (kind && ["doi", "arxiv_id", "semantic_scholar_id", "openalex_id", "openreview_id", "dblp_key", "pmlr_id", "title_authors_year_hash"].includes(kind)) result.literatureIdentityKind = kind;
  const limit = Number(params.get("limit"));
  if (Number.isSafeInteger(limit) && limit > 0 && limit <= 100) result.limit = limit;
  return result;
}
export function readCommunityRoute() {
  const annotation = window.location.pathname.match(/^\/annotations\/([^/]+)$/);
  const source = window.location.pathname.match(/^\/sources\/(intuecho\.(?:annotation|reply|literature))\/([^/]+)$/);
  const revision = Number(new URLSearchParams(window.location.search).get("revision"));
  try {
    return {
      annotationId: annotation ? decodeURIComponent(annotation[1]) : null,
      source: source && Number.isSafeInteger(revision) && revision > 0
        ? { sourceNamespace: source[1] as CommunitySourceReference["sourceNamespace"], sourceId: decodeURIComponent(source[2]), revision } : null
    };
  } catch { return { annotationId: null, source: null }; }
}
