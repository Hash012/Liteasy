import { paperServiceRequest, validatePaperService, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { citationKey, normalizeCitationDoi, openAlexId, type CitationDirection, type CitationEdge, type CitationPaper, type CitationWork } from "./citationGraph";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === "string" ? value : "";
const https = (value: unknown) => typeof value === "string" && /^https:\/\//i.test(value) ? value : undefined;
export function parseCitationWork(value: unknown): CitationWork | undefined {
  const row = record(value); const id = openAlexId(row.id);
  if (!id || !string(row.title).trim()) return undefined;
  const count = Number(row.cited_by_count);
  return { id, doi: normalizeCitationDoi(row.doi), title: string(row.title).slice(0, 2000),
    authors: array(row.authorships).slice(0, 100).map((entry) => string(record(record(entry).author).display_name)).filter(Boolean),
    citationCount: Number.isFinite(count) ? Math.max(0, count) : 0,
    year: typeof row.publication_year === "number" ? row.publication_year : undefined,
    references: [...new Set(array(row.referenced_works).map(openAlexId).filter((id): id is string => Boolean(id)))],
    pdfUrl: https(record(row.best_oa_location).pdf_url) ?? https(record(row.primary_location).pdf_url) };
}
const fields = "id,doi,title,authorships,publication_year,cited_by_count,referenced_works,best_oa_location,primary_location";
const rank = (left: CitationWork, right: CitationWork) => right.citationCount - left.citationCount || left.id.localeCompare(right.id);
/** A scope-owned session cache. No shared cache, title guessing, or credentials in URLs. */
export function createCitationGraphClient(input?: PaperServiceConfig) {
  const config: PaperServiceConfig = input?.provider === "openalex" ? input : { provider: "openalex", endpoint: "https://api.openalex.org" };
  const cache = new Map<string, { at: number; rows: CitationWork[]; count: number }>();
  const get = async (filter: string, perPage: number, signal: AbortSignal, page = 1) => {
    signal.throwIfAborted();
    const key = `${filter}:${perPage}:${page}`;
    const found = cache.get(key);
    if (found && Date.now() - found.at < 15 * 60_000) return found;
    const url = new URL(`${validatePaperService(config).endpoint}/works`);
    url.searchParams.set("filter", filter); url.searchParams.set("per-page", String(perPage));
    url.searchParams.set("page", String(page)); url.searchParams.set("sort", "cited_by_count:desc"); url.searchParams.set("select", fields);
    const response = await paperServiceRequest(config, url.href, { signal, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? "OpenAlex 需要有效的 API 凭据，请在设置的文献服务中配置 OpenAlex。"
      : response.status === 429 ? "OpenAlex 请求限流，请稍后重试。" : `引用查询失败（HTTP ${response.status}），可稍后重试。`);
    const body = record(await response.json()); signal.throwIfAborted();
    if (!Array.isArray(body.results)) throw new Error("引用服务返回了无法识别的数据。");
    const rows = body.results.map(parseCitationWork).filter((row): row is CitationWork => Boolean(row));
    const entry = { at: Date.now(), rows, count: Number(record(body.meta).count) || rows.length };
    if (cache.size >= 16) cache.delete(cache.keys().next().value!);
    cache.set(key, entry); return entry;
  };
  const loadLibrary = async (papers: CitationPaper[], signal: AbortSignal) => {
    const works = new Map<string, CitationWork>(); const errors: string[] = [];
    const dois = [...new Set(papers.map((paper) => paper.doi).filter((id): id is string => Boolean(id)))];
    const ids = [...new Set(papers.filter((paper) => !paper.doi).map((paper) => paper.openAlexId).filter((id): id is string => Boolean(id)))];
    // Exact DOI/OpenAlex batches; never use filenames or title resemblance as evidence of a citation.
    for (const [field, values] of [["doi", dois], ["openalex", ids]] as const) {
      for (let start = 0; start < values.length; start += 40) {
        try {
          const wanted = new Set(values.slice(start, start + 40));
          const response = await get(`${field}:${[...wanted].join("|")}`, 100, signal);
          for (const work of response.rows) if (wanted.has(field === "doi" ? work.doi ?? "" : work.id)) works.set(work.id, work);
        } catch (error) { signal.throwIfAborted(); errors.push(error instanceof Error ? error.message : "引用查询失败"); }
      }
    }
    return { works: [...works.values()], errors: [...new Set(errors)], identified: papers.filter(citationKey).length };
  };
  const expand = async (seed: CitationWork, library: CitationWork[], direction: CitationDirection, topK: number, signal: AbortSignal) => {
    const k = Math.max(1, Math.min(50, Math.round(topK) || 10));
    const local = new Set(library.map((work) => work.id)); local.add(seed.id);
    const candidates = new Map<string, CitationWork>(); const edges = new Map<string, CitationEdge>();
    const errors: string[] = []; let limited = false;
    const add = (work: CitationWork, source: string, target: string) => {
      if (local.has(work.id)) return;
      candidates.set(work.id, work); edges.set(`${source}:${target}`, { id: `${source}:${target}`, source, target });
    };
    if (direction !== "citations") {
      const refs = seed.references.filter((id) => !local.has(id));
      // Query every batch before ranking: the highest-cited reference may be at the end of the list.
      for (let start = 0; start < Math.min(refs.length, 2000); start += 100) {
        try {
          const wanted = new Set(refs.slice(start, start + 100));
          const response = await get(`openalex:${[...wanted].join("|")}`, k, signal);
          response.rows.filter((work) => wanted.has(work.id)).forEach((work) => add(work, seed.id, work.id));
        } catch (error) { signal.throwIfAborted(); errors.push(error instanceof Error ? error.message : "参考文献查询失败"); }
      }
      limited = refs.length > 2000;
    }
    if (direction !== "references") {
      try {
        let externalCount = 0;
        for (let page = 1; page <= 10 && externalCount < k; page++) {
          const response = await get(`cites:${seed.id}`, 100, signal, page);
          for (const work of response.rows) if (!local.has(work.id) && work.references.includes(seed.id)) {
            add(work, work.id, seed.id); externalCount++;
          }
          if (response.count <= page * 100) break;
          if (page === 10 && externalCount < k) limited = true;
        }
      } catch (error) { signal.throwIfAborted(); errors.push(error instanceof Error ? error.message : "被引论文查询失败"); }
    }
    const works = [...candidates.values()].sort(rank).slice(0, k); const chosen = new Set(works.map((work) => work.id));
    return { works, edges: [...edges.values()].filter((edge) => chosen.has(edge.source) || chosen.has(edge.target)), errors: [...new Set(errors)], limited };
  };
  return { loadLibrary, expand };
}
