import { paperServiceRequest, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
import type { RecommendationRequestDocument } from "./recommendation.types";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
/** Bounded exact-ID graph expansion; provider URLs and keys stay within the configured adapter. */
export async function recallCitations(config: PaperServiceConfig, seed: RecommendationRequestDocument, signal: AbortSignal) {
  if (!seed.doi) return [];
  const base = config.endpoint.replace(/\/+$/, "");
  const get = async (path: string) => {
    const response = await paperServiceRequest(config, `${base}${path}`, { signal, timeoutMs: 8000, maxResponseBytes: 4 * 1024 * 1024 });
    if (!response.ok) throw new Error(`引用关系查询返回 HTTP ${response.status}`);
    return object(await response.json());
  };
  if (config.provider === "openalex") {
    const work = await get(`/works/${encodeURIComponent(`https://doi.org/${seed.doi}`)}`);
    if (String(work.doi).toLowerCase() !== `https://doi.org/${seed.doi}`.toLowerCase()) return [];
    const id = String(work.id).match(/W\d+$/)?.[0]; if (!id) return [];
    const refs = list(work.referenced_works).map((value) => String(value).match(/W\d+$/)?.[0]).filter(Boolean).slice(0, 20);
    // https://help.openalex.org/how-to/api-recipes/#following-citations
    const requests = [{ relation: "cites_target" as const, path: `/works?filter=${encodeURIComponent(`cites:${id}`)}&per-page=20` },
      ...(refs.length ? [{ relation: "cited_by_target" as const, path: `/works?filter=${encodeURIComponent(`openalex:${refs.join("|")}`)}&per-page=20` }] : [])];
    return (await Promise.allSettled(requests.map(async (request) => ({ relation: request.relation, items: list((await get(request.path)).results) })))).flatMap((row) => row.status === "fulfilled" ? [row.value] : []);
  }
  if (config.provider === "crossref") {
    const work = object((await get(`/works/${encodeURIComponent(seed.doi)}`)).message);
    if (String(work.DOI).toLowerCase() !== seed.doi.toLowerCase()) return [];
    const references = list(work.reference).map((row) => object(row).DOI).filter((value): value is string => typeof value === "string" && /^10\.\d+\//.test(value)).slice(0, 3);
    const records = await Promise.allSettled(references.map(async (doi) => object((await get(`/works/${encodeURIComponent(doi)}`)).message)));
    return [{ relation: "cited_by_target" as const, items: records.flatMap((row) => row.status === "fulfilled" ? [row.value] : []) }];
  }
  return [];
}
