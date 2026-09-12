import type { LiteratureAuthorityClient } from "../paper-identity/literatureAuthorityClient";
import type { LiteratureCandidate, LiteratureRecord, LiteratureResolveResult } from "../paper-identity/literature.types";
import { normalizeLiteratureRecord } from "../paper-identity/literatureRecord";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import { paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";
import { loadDurableEntries, putDurableEntry } from "../persistence/durableJsonStore";

export function createMetadataProviderClient(config: PaperServiceConfig): LiteratureAuthorityClient {
  const candidates = new Map<string, LiteratureCandidate>();
  async function read(url: URL) {
    const response = await paperServiceRequest(config, url.href);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`元信息服务请求失败（HTTP ${response.status}），请检查接入设置。`);
    return response.json();
  }
  return {
    async resolveLiterature(input): Promise<LiteratureResolveResult> {
      const doi = normalizeLiteratureIdentifier("doi", input.hints?.identifiers?.find((id) => id.kind === "doi")?.value ?? input.query);
      const query = doi || input.query || input.hints?.title || "";
      if (!query.trim()) return { status: "not_found", candidates: [], unavailableProviders: [] };
      const exactPath = config.provider === "semantic-scholar" ? `/paper/DOI:${encodeURIComponent(doi)}`
        : config.provider === "openalex" ? `/works/doi:${encodeURIComponent(doi)}` : `/works/${encodeURIComponent(doi)}`;
      const url = new URL(config.endpoint.replace(/\/+$/, "") + (doi ? exactPath : config.provider === "semantic-scholar" ? "/paper/search" : "/works"));
      if (doi) { if (config.provider === "semantic-scholar") url.searchParams.set("fields", "title,authors,year,externalIds,url"); }
      else if (config.provider === "crossref") { url.searchParams.set("query.bibliographic", query); url.searchParams.set("rows", "5"); }
      else if (config.provider === "openalex") { url.searchParams.set("search", query); url.searchParams.set("per-page", "5"); }
      else { url.searchParams.set("query", query); url.searchParams.set("limit", "5"); url.searchParams.set("fields", "title,authors,year,externalIds,url"); }
      const payload = await read(url);
      if (!payload) return { status: "not_found", candidates: [], unavailableProviders: [] };
      const items = doi ? [config.provider === "crossref" ? payload.message : payload]
        : config.provider === "crossref" ? payload.message?.items : config.provider === "openalex" ? payload.results : payload.data;
      if (!Array.isArray(items)) throw new Error("元信息服务返回格式不正确。");
      const results: LiteratureCandidate[] = items.flatMap((item: any) => {
        const title = config.provider === "crossref" ? item.title?.[0] : item.title ?? item.display_name;
        const id = item.DOI ?? item.doi?.replace(/^https?:\/\/doi.org\//, "") ?? item.externalIds?.DOI;
        const identifiers: LiteratureCandidate["record"]["identifiers"] = id ? [{ kind: "doi", source: "public_registry", value: id.toLowerCase() }] : [];
        if (!id && config.provider === "openalex" && item.id) identifiers.push({ kind: "openalex_id", source: "public_registry", value: item.id.split("/").pop() });
        if (!id && config.provider === "semantic-scholar" && item.paperId) identifiers.push({ kind: "semantic_scholar_id", source: "public_registry", value: item.paperId });
        if (!title || !identifiers.length) return [];
        const provider = config.provider === "semantic-scholar" ? "semantic_scholar" : config.provider as "crossref" | "openalex";
        const candidate: LiteratureCandidate = {
          candidateKey: `${provider}:${identifiers[0].value}`, provider,
          record: { title, identifiers,
            authors: config.provider === "crossref" ? (item.author ?? []).map((author: any) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean)
              : config.provider === "openalex" ? (item.authorships ?? []).map((author: any) => author.author?.display_name).filter(Boolean)
              : (item.authors ?? []).map((author: any) => author.name).filter(Boolean),
            year: item.year ?? item.publication_year ?? item.published?.["date-parts"]?.[0]?.[0]
          }, recordUrl: item.URL ?? item.url ?? item.id
        };
        candidates.set(candidate.candidateKey, candidate);
        return [candidate];
      });
      const exact = doi ? results.find((candidate) => candidate.record.identifiers.some((id) => id.kind === "doi" && id.value.toLowerCase() === doi.toLowerCase())) : undefined;
      return exact ? { status: "exact", candidate: exact, confirmationMode: "candidate", unavailableProviders: [] }
        : results.length ? { status: "ambiguous", candidates: results, unavailableProviders: [] } : { status: "not_found", candidates: [], unavailableProviders: [] };
    },
    async confirmLiterature(input) {
      const candidate = candidates.get(input.candidateKey);
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
