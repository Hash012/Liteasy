import type { LiteratureAuthorityClient } from "../paper-identity/literatureAuthorityClient";
import type { LiteratureCandidate, LiteratureRecord, LiteratureResolveResult } from "../paper-identity/literature.types";
import { normalizeLiteratureRecord } from "../paper-identity/literatureRecord";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import { paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";
import { loadDurableEntries, putDurableEntry } from "../persistence/durableJsonStore";
import { readArxivMetadata } from "./arxivMetadata";
import { createPmlrMetadataReader } from "./pmlrMetadata";
import { readableBibliographicTitle } from "../metadata/pdfRecognition";

export function createMetadataProviderClient(config: PaperServiceConfig): LiteratureAuthorityClient {
  const candidates = new Map<string, LiteratureCandidate>();
  const readPmlrMetadata = createPmlrMetadataReader(config);
  function remember(candidate: LiteratureCandidate) {
    candidates.set(candidate.candidateKey, candidate);
    if (candidates.size > 200) candidates.delete(candidates.keys().next().value!);
  }
  async function read(url: URL) {
    const response = await paperServiceRequest(config, url.href);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`元信息服务请求失败（HTTP ${response.status}），请检查接入设置。`);
    return response.json();
  }
  return {
    async resolveLiterature(input): Promise<LiteratureResolveResult> {
      const doi = normalizeLiteratureIdentifier("doi", input.hints?.identifiers?.find((id) => id.kind === "doi")?.value ?? input.query);
      const arxivId = normalizeLiteratureIdentifier("arxiv_id", input.hints?.identifiers?.find((id) => id.kind === "arxiv_id")?.value ?? (normalizeLiteratureIdentifier("arxiv_id", input.query) ||
        (/^10\.48550\/arxiv\./i.test(doi) ? doi.replace(/^10\.48550\/arxiv\./i, "") : "")));
      if (arxivId) {
        const candidate = await readArxivMetadata(config, arxivId);
        if (!candidate) return { status: "not_found", candidates: [], unavailableProviders: [] };
        remember(candidate);
        return { status: "exact", candidate, confirmationMode: "candidate", unavailableProviders: [] };
      }
      const pmlr = await readPmlrMetadata(input);
      if (pmlr) {
        if (pmlr.status === "exact") remember(pmlr.candidate);
        else if ("candidates" in pmlr) pmlr.candidates.forEach(remember);
        return pmlr;
      }
      const query = doi || input.hints?.title || input.query || "";
      if (!query.trim()) return { status: "not_found", candidates: [], unavailableProviders: [] };
      const exactPath = config.provider === "semantic-scholar" ? `/paper/DOI:${encodeURIComponent(doi)}`
        : config.provider === "openalex" ? `/works/doi:${encodeURIComponent(doi)}` : `/works/${encodeURIComponent(doi)}`;
      const url = new URL(config.endpoint.replace(/\/+$/, "") + (doi ? exactPath : config.provider === "semantic-scholar" ? "/paper/search" : "/works"));
      if (doi) { if (config.provider === "semantic-scholar") url.searchParams.set("fields", "title,authors,year,externalIds,url"); }
      else if (config.provider === "crossref") { url.searchParams.set("query.bibliographic", query); url.searchParams.set("rows", String(Math.max(5, Math.min(20, input.limit ?? 10)))); if (input.hints?.title) url.searchParams.set("query.title", input.hints.title); if (input.hints?.authors?.length) url.searchParams.set("query.author", input.hints.authors.join(" ")); }
      else if (config.provider === "openalex") { url.searchParams.set("search", query); url.searchParams.set("per-page", "5"); }
      else { url.searchParams.set("query", query); url.searchParams.set("limit", "5"); url.searchParams.set("fields", "title,authors,year,externalIds,url"); }
      const payload = await read(url);
      if (!payload) return { status: "not_found", candidates: [], unavailableProviders: [] };
      const items = doi ? [config.provider === "crossref" ? payload.message : payload]
        : config.provider === "crossref" ? payload.message?.items : config.provider === "openalex" ? payload.results : payload.data;
      if (!Array.isArray(items)) throw new Error("元信息服务返回格式不正确。");
      const results: LiteratureCandidate[] = items.flatMap((item: any) => {
        if (!item || typeof item !== "object") return [];
        const rawTitle = config.provider === "crossref" ? item.title?.[0] : item.title ?? item.display_name;
        const title = typeof rawTitle === "string" ? readableBibliographicTitle(rawTitle) : "";
        const id = item.DOI ?? (typeof item.doi === "string" ? item.doi.replace(/^https?:\/\/doi.org\//, "") : undefined) ?? item.externalIds?.DOI;
        const identifiers: LiteratureCandidate["record"]["identifiers"] = typeof id === "string" && normalizeLiteratureIdentifier("doi", id) ? [{ kind: "doi", source: "public_registry", value: id.toLowerCase() }] : [];
        if (!identifiers.length && config.provider === "openalex" && typeof item.id === "string" && normalizeLiteratureIdentifier("openalex_id", item.id)) identifiers.push({ kind: "openalex_id", source: "public_registry", value: item.id.split("/").pop() });
        if (!identifiers.length && config.provider === "semantic-scholar" && typeof item.paperId === "string" && normalizeLiteratureIdentifier("semantic_scholar_id", item.paperId)) identifiers.push({ kind: "semantic_scholar_id", source: "public_registry", value: item.paperId });
        if (!title || !identifiers.length) return [];
        const provider = config.provider === "semantic-scholar" ? "semantic_scholar" : config.provider as "crossref" | "openalex";
        const candidate: LiteratureCandidate = {
          candidateKey: `${provider}:${identifiers[0].value}`, provider,
          record: { title, identifiers,
            authors: config.provider === "crossref" ? (Array.isArray(item.author) ? item.author : []).filter(Boolean).map((author: any) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean)
              : config.provider === "openalex" ? (Array.isArray(item.authorships) ? item.authorships : []).filter(Boolean).map((author: any) => author.author?.display_name).filter(Boolean)
              : (Array.isArray(item.authors) ? item.authors : []).filter(Boolean).map((author: any) => author.name).filter(Boolean),
            year: item.year ?? item.publication_year ?? item.published?.["date-parts"]?.[0]?.[0]
          }, recordUrl: item.URL ?? item.url ?? item.id
        };
        candidate.record.authors = candidate.record.authors.filter((author) => typeof author === "string" && author.trim()).map((author) => author.trim().slice(0, 300)).slice(0, 200);
        if (!Number.isInteger(candidate.record.year) || candidate.record.year! < 1000 || candidate.record.year! > 9999) delete candidate.record.year;
        if (typeof candidate.recordUrl !== "string" || !/^https?:\/\//i.test(candidate.recordUrl)) delete candidate.recordUrl;
        if (candidate.record.title.length > 1000) return [];
        remember(candidate);
        return [candidate];
      });
      const exact = doi ? results.find((candidate) => candidate.record.identifiers.some((id) => id.kind === "doi" && id.value.toLowerCase() === doi.toLowerCase())) : undefined;
      return exact ? { status: "exact", candidate: exact, confirmationMode: "candidate", unavailableProviders: [] }
        : results.length ? { status: "ambiguous", candidates: results, unavailableProviders: [] } : { status: "not_found", candidates: [], unavailableProviders: [] };
    },
    async confirmLiterature(input) {
      let candidate = candidates.get(input.candidateKey);
      if (!candidate) {
        // Persisted candidate lists outlive this client's in-memory search cache.
        // Fetch by its registry identifier again instead of trusting a stale title.
        const separator = input.candidateKey.indexOf(":");
        const provider = input.candidateKey.slice(0, separator);
        const value = input.candidateKey.slice(separator + 1);
        const expectedProvider = config.provider === "semantic-scholar" ? "semantic_scholar" : config.provider;
        if (provider === "arxiv" && normalizeLiteratureIdentifier("arxiv_id", value)) {
          candidate = await readArxivMetadata(config, value) ?? undefined;
        } else if (provider === "pmlr" && value.startsWith("pmlr_id:")) {
          const result = await readPmlrMetadata({ purpose: "liteasy_pdf_annotation", hints: {
            identifiers: [{ kind: "pmlr_id", value: value.slice("pmlr_id:".length) }]
          } });
          if (result?.status === "exact" && result.candidate.candidateKey === input.candidateKey) candidate = result.candidate;
        } else if (provider === expectedProvider && normalizeLiteratureIdentifier("doi", value)) {
          const result = await this.resolveLiterature({ purpose: "liteasy_pdf_annotation", hints: { identifiers: [{ kind: "doi", value }] } });
          if (result.status === "exact" && result.candidate.candidateKey === input.candidateKey) candidate = result.candidate;
        }
      }
      if (!candidate) throw new Error("候选已过期，请重新查询后确认。");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidate.candidateKey));
      const literature = normalizeLiteratureRecord({ ...candidate.record,
        literatureId: `registry_${Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2,"0")).join("")}`,
        status: "confirmed", revision: 1, provenance: { confirmedAt: new Date().toISOString(), mode: "public_registry", provider: candidate.provider }
      });
      await putDurableEntry("paper-services", literature.literatureId, literature);
      return { literature };
    },
    async verifyLiterature(reference) {
      const record = (await loadDurableEntries("paper-services"))[reference.literatureId] as LiteratureRecord | undefined;
      if (!record) throw new Error("本机没有此文献的确认记录，请重新查询。 ");
      return normalizeLiteratureRecord(record);
    },
    async literatureRelations(literatureId) { return { literatureId, claims: [], versions: [] }; }
  };
}
