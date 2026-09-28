import type { LiteratureCandidate, LiteratureResolveInput, LiteratureResolveResult } from "../paper-identity/literature.types";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import { parsePdfAuthors } from "../paper-identity/literatureRecord";
import { paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const wantedFields = new Set(["title", "author", "year", "volume", "publisher", "url", "doi"]);
const titleKey = (title: string) => title.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// PMLR's generated bibliography uses braced literal fields. Scan balanced braces
// instead of splitting on commas/braces inside titles, authors or abstracts.
// Unsupported BibTeX expressions are rejected, never evaluated or guessed.
function readFields(text: string): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  const field = /\s*([a-z]+)\s*=\s*\{/iy;
  let cursor = 0;
  while (cursor < text.length) {
    if (!text.slice(cursor).trim()) break;
    field.lastIndex = cursor;
    const match = field.exec(text);
    if (!match) return undefined;
    const name = match[1].toLowerCase();
    const start = field.lastIndex;
    let depth = 1;
    cursor = start;
    for (; cursor < text.length && depth; cursor++) {
      if (text[cursor] === "\\") { cursor++; continue; }
      if (text[cursor] === "{") depth++;
      if (text[cursor] === "}") depth--;
    }
    if (depth) return undefined;
    if (wantedFields.has(name)) {
      if (Object.prototype.hasOwnProperty.call(fields, name)) return undefined;
      fields[name] = text.slice(start, cursor - 1).replace(/\\([&%_#$])/g, "$1")
        .replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    }
    while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
    if (text[cursor] === ",") cursor++;
    else if (cursor < text.length) return undefined;
  }
  return fields;
}

export async function parsePmlrBibliography(bytes: Uint8Array<ArrayBuffer>, volume: number): Promise<LiteratureCandidate[]> {
  if (bytes.byteLength > MAX_BYTES) throw new Error("PMLR 题录超过大小限制。");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const artifactHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")}` as const;
  const artifactUrl = `https://proceedings.mlr.press/v${volume}/assets/bib/bibliography.bib`;
  const entries = new Map<string, LiteratureCandidate>();
  const seen = new Set<string>();
  const header = /^@InProceedings\{(pmlr-v[1-9]\d{0,3}-[a-z0-9][a-z0-9._-]{0,199}),\s*/gim;
  let count = 0;
  for (let match = header.exec(text); match; match = header.exec(text)) {
    if (++count > MAX_ENTRIES) throw new Error("PMLR 题录条目超过限制。");
    const entryKey = match[1].toLowerCase();
    const id = normalizeLiteratureIdentifier("pmlr_id", entryKey);
    if (!id.startsWith(`v${volume}/`)) continue;
    if (seen.has(id)) { entries.delete(id); continue; }
    seen.add(id);
    let end = header.lastIndex;
    let depth = 1;
    for (; end < text.length && depth; end++) {
      if (text[end] === "\\") { end++; continue; }
      if (text[end] === "{") depth++;
      if (text[end] === "}") depth--;
    }
    if (depth) continue;
    const fields = readFields(text.slice(header.lastIndex, end - 1));
    header.lastIndex = end;
    if (!fields || fields.publisher !== "PMLR" || Number(fields.volume) !== volume ||
      fields.url !== `https://proceedings.mlr.press/${id}.html` || !fields.title || fields.title.length > 1000) continue;
    const year = Number(fields.year);
    const authors = parsePdfAuthors(fields.author).map((author) => {
      const parts = author.split(",").map((part) => part.trim());
      return parts.length === 2 ? `${parts[1]} ${parts[0]}` : author;
    });
    if (!Number.isInteger(year) || year < 1000 || year > 9999 || !authors.length) continue;
    const doi = normalizeLiteratureIdentifier("doi", fields.doi);
    entries.set(id, {
      candidateKey: `pmlr:pmlr_id:${id}`, provider: "pmlr", recordUrl: fields.url,
      sourceEvidence: { artifactHash, artifactUrl, entryKey, sourceKind: "official_volume_bibtex", volume },
      record: { title: fields.title, authors, year, documentType: "conference-paper", identifiers: [
        { kind: "pmlr_id", value: id, source: "public_registry" },
        ...(doi ? [{ kind: "doi" as const, value: doi, source: "public_registry" as const }] : [])
      ] }
    });
  }
  if (count === 0) throw new Error("PMLR 未返回可识别的卷级题录，请稍后重试。");
  return [...entries.values()];
}

async function readVolume(config: PaperServiceConfig, volume: number) {
  const response = await paperServiceRequest(config,
    `https://proceedings.mlr.press/v${volume}/assets/bib/bibliography.bib`,
    { authenticate: false, maxResponseBytes: MAX_BYTES, timeoutMs: 25_000 });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`PMLR 题录请求失败（HTTP ${response.status}），请稍后重试。`);
  return parsePmlrBibliography(new Uint8Array(await response.arrayBuffer()), volume);
}

export async function readPmlrArticle(config: PaperServiceConfig, id: string): Promise<LiteratureCandidate | undefined> {
  const volume = Number(id.match(/^v(\d+)\//)?.[1]);
  const url = `https://proceedings.mlr.press/${id}.html`;
  const response = await paperServiceRequest(config, url, { authenticate: false, maxResponseBytes: 512 * 1024, timeoutMs: 8_000 });
  if (!response.ok) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const page = new DOMParser().parseFromString(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "text/html");
  if (page.querySelector('meta[name="citation_abstract_html_url"]')?.getAttribute("content") !== url ||
    page.querySelector('meta[name="citation_publisher"]')?.getAttribute("content") !== "PMLR") return undefined;
  const bibtex = page.querySelector("code#bibtex")?.textContent;
  if (!bibtex) return undefined;
  const candidates = await parsePmlrBibliography(new TextEncoder().encode(bibtex), volume);
  const candidate = candidates.find((item) => item.candidateKey === `pmlr:pmlr_id:${id}`);
  if (!candidate || candidates.length !== 1 || titleKey(candidate.record.title) !==
    titleKey(page.querySelector('meta[name="citation_title"]')?.getAttribute("content") ?? "")) return undefined;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { ...candidate, sourceEvidence: { ...candidate.sourceEvidence!, artifactHash: `sha256:${hash}`,
    artifactUrl: url, sourceKind: "official_article_page" } };
}

export function createPmlrMetadataReader(config: PaperServiceConfig) {
  // Keep one compact, parsed volume only; release downloaded text/abstracts.
  let cache: { volume: number; expires: number; entries: Promise<LiteratureCandidate[]> } | undefined;
  const articles = new Map<string, { expires: number; result: Promise<LiteratureCandidate | undefined> }>();
  return async (input: LiteratureResolveInput): Promise<LiteratureResolveResult | undefined> => {
    const id = normalizeLiteratureIdentifier("pmlr_id", input.hints?.identifiers?.find((item) => item.kind === "pmlr_id")?.value ?? input.query);
    const volume = id ? Number(id.match(/^v(\d+)\//)?.[1]) : input.hints?.pmlr?.volume;
    if (!volume || !Number.isInteger(volume) || volume < 1 || volume > 9999) return undefined;
    const requestedTitle = titleKey(input.hints?.title ?? (id ? "" : input.query) ?? "");
    if (id) {
      let article = articles.get(id);
      if (!article || article.expires < Date.now()) {
        article = { expires: Date.now() + 5 * 60_000, result: readPmlrArticle(config, id).catch(() => undefined) };
        articles.set(id, article);
        if (articles.size > 50) articles.delete(articles.keys().next().value!);
      }
      const candidate = await article.result;
      if (candidate && (!requestedTitle || titleKey(candidate.record.title) === requestedTitle)) {
        return { status: "exact", candidate, confirmationMode: "candidate", unavailableProviders: [] };
      }
    }
    if (!cache || cache.volume !== volume || cache.expires < Date.now()) {
      const next = { volume, expires: Date.now() + 5 * 60_000, entries: readVolume(config, volume) };
      cache = next;
      void next.entries.catch(() => { if (cache === next) cache = undefined; });
    }
    const year = input.hints?.year ?? input.hints?.pmlr?.year;
    const results = (await cache.entries).filter((candidate) => id && !requestedTitle
      ? candidate.record.identifiers.some((item) => item.kind === "pmlr_id" && item.value === id)
      : requestedTitle.length >= 8 && titleKey(candidate.record.title).includes(requestedTitle) && (!year || candidate.record.year === year)
    ).slice(0, Math.max(1, Math.min(20, input.limit ?? 5)));
    if (id && results.length === 1 && results[0].record.identifiers.some((item) => item.kind === "pmlr_id" && item.value === id)) {
      return { status: "exact", candidate: results[0], confirmationMode: "candidate", unavailableProviders: [] };
    }
    return results.length ? { status: "ambiguous", candidates: results, unavailableProviders: [] }
      : { status: "not_found", candidates: [], unavailableProviders: [] };
  };
}
