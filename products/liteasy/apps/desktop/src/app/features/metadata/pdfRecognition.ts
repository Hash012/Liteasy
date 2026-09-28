import type { LiteratureCandidate, LiteratureResolveInput, LiteratureResolveResult } from "../paper-identity/literature.types";
import { inferPaperIdentityMetadataFromPdfText } from "../paper-identity/paperIdentity";
import { parsePmlrHint } from "../paper-identity/literatureRecord";

export type PdfRecognitionEvidence = { firstPageText: string; embeddedTitle?: string; titleText?: string; sourceName?: string };

export function readableBibliographicTitle(value: string) {
  // Registry titles may contain JATS/HTML emphasis and inline formula markup.
  const plain = /<\/?[a-z][^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(value)
    ? new DOMParser().parseFromString(value, "text/html").body.textContent ?? value : value;
  return plain.replace(/\s+/g, " ").trim();
}

function normalized(value: string) {
  return readableBibliographicTitle(value)
    .replace(/\\(?:text|textrm|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega)\b/g, (_, name: string) =>
      ({ alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω" })[name] ?? name)
    .normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function headingText(text: string) {
  return text.split(/\ba\s*b\s*s\s*t\s*r\s*a\s*c\s*t\b|\breferences\b|\bbibliography\b|摘要|参考文献/i)[0].slice(0, 4000);
}

function titleFromLines(heading: string): string | undefined {
  const lines = heading.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  // Keep publisher banners, copyright notices and identifiers out of title queries.
  const noise = /^(?:https?:|www\.|doi\b|arxiv\b|vol(?:ume)?[ .]|issn\b|isbn\b|copyright|©|received\b|accepted\b|published\b|available online|journal of |proceedings of |research article$|original article$|a preprint$)|@/i;
  const start = lines.findIndex((line) => !noise.test(line) && normalized(line).length >= 8 && line.length <= 250);
  if (start < 0) return undefined;
  const line = lines[start];
  // Only join a following line when punctuation marks an explicit continuation;
  // the next ordinary line is often the author list.
  const next = lines[start + 1];
  return next && /[-:]$/.test(line) && !noise.test(next) && next.length < 180
    ? `${line.replace(/-$/, "")} ${next}` : line;
}

export function buildPdfRecognitionRequest(evidence: PdfRecognitionEvidence): LiteratureResolveInput | undefined {
  const heading = headingText(evidence.firstPageText);
  const identity = inferPaperIdentityMetadataFromPdfText(evidence.firstPageText);
  const identifiers: NonNullable<LiteratureResolveInput["hints"]>["identifiers"] = [];
  if (identity.doi) identifiers.push({ kind: "doi", value: identity.doi });
  if (identity.arxivId) identifiers.push({ kind: "arxiv_id", value: identity.arxivId });
  const pmlr = parsePmlrHint(evidence.firstPageText.slice(0, 20_000));
  const slug = evidence.sourceName?.replace(/\\/g, "/").split("/").at(-1)?.replace(/\.pdf$/i, "");
  // A filename is only a lookup hint: the official record still has to match
  // the PDF title, author and imprint before automatic confirmation.
  if (pmlr && slug && /^[a-z][a-z0-9._-]{0,100}\d{2}[a-z]$/i.test(slug)) {
    identifiers.push({ kind: "pmlr_id", value: `v${pmlr.volume}/${slug.toLowerCase()}` });
  }
  const title = [evidence.embeddedTitle, evidence.titleText].find((value) => value &&
    normalized(value).length >= 8 && normalized(heading).includes(normalized(value)));
  // A bounded bibliographic query is only a search hint, never a title to save directly.
  const searchTitle = title || titleFromLines(heading);
  const query = searchTitle ? readableBibliographicTitle(searchTitle).slice(0, 350) : heading.replace(/\s+/g, " ").trim().slice(0, 350);
  if (!identifiers.length && normalized(query).length < (title ? 8 : 15)) return undefined;
  return { purpose: "liteasy_pdf_annotation", limit: 5, query, hints: { identifiers,
    ...(pmlr ? { pmlr, year: pmlr.year } : {}), ...(searchTitle ? { title: query } : {}) } };
}

export function selectPdfRecognitionCandidate(
  result: LiteratureResolveResult, evidence: PdfRecognitionEvidence
): LiteratureCandidate | undefined {
  if (result.status !== "exact" && result.status !== "ambiguous") return undefined;
  const heading = normalized(headingText(evidence.firstPageText));
  const identity = inferPaperIdentityMetadataFromPdfText(evidence.firstPageText);
  const pmlr = parsePmlrHint(evidence.firstPageText.slice(0, 20_000));
  const candidates = result.status === "exact" ? [result.candidate] : result.candidates;
  const matches = candidates.filter(({ record }) => {
    if (pmlr && !identity.arxivId && (!record.identifiers.some((id) =>
      id.kind === "pmlr_id" && id.value.startsWith(`v${pmlr.volume}/`)) || record.year !== pmlr.year)) return false;
    if (identity.arxivId && !record.identifiers.some((id) => id.kind === "arxiv_id" &&
      (/v\d+$/.test(identity.arxivId!) ? id.value === identity.arxivId : id.value.replace(/v\d+$/, "") === identity.arxivId))) return false;
    const title = normalized(record.title);
    if (title.length < 8 || !heading.includes(title)) return false;
    const identifierMatches = record.identifiers.some((id) =>
      (id.kind === "doi" && identity.doi?.toLowerCase() === id.value.toLowerCase()) ||
      (id.kind === "arxiv_id" && identity.arxivId && id.value.replace(/v\d+$/, "") === identity.arxivId.replace(/v\d+$/, "")));
    if (result.status === "exact" && identifierMatches) return true;
    // Title searches must also agree with a creator on the first page.
    return record.authors.some((author) => {
      const family = normalized(author.includes(",") ? author.split(",")[0] : author.trim().split(/\s+/).at(-1) ?? "");
      return family.length >= 3 ? heading.includes(family) : family.length >= 2 &&
        headingText(evidence.firstPageText).split(/[\s,;·]+/).some((word) => normalized(word.replace(/\d+$/, "")) === family);
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function buildMetadataPdfFileName(record: { title: string; authors: readonly string[]; year?: number }) {
  const author = record.authors[0];
  let name = [author ? `${author}${record.authors.length > 1 ? " et al." : ""}` : "", record.year, readableBibliographicTitle(record.title)]
    .filter(Boolean).join(" - ").normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  // Leave room for a collision suffix; limit UTF-8 bytes as well as Windows characters.
  let stem = "";
  for (const character of name) {
    if (new TextEncoder().encode(stem + character).length > 210) break;
    stem += character;
  }
  name = stem.replace(/[. ]+$/, "") || "Document";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.pdf`;
}
