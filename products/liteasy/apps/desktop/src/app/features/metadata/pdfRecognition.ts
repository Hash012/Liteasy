import type { LiteratureCandidate, LiteratureResolveInput, LiteratureResolveResult } from "../paper-identity/literature.types";
import { inferPaperIdentityMetadataFromPdfText } from "../paper-identity/paperIdentity";

export type PdfRecognitionEvidence = { firstPageText: string; embeddedTitle?: string };

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function headingText(text: string) {
  return text.split(/\babstract\b|\breferences\b|\bbibliography\b|摘要|参考文献/i)[0].slice(0, 3000);
}

export function buildPdfRecognitionRequest(evidence: PdfRecognitionEvidence): LiteratureResolveInput | undefined {
  const heading = headingText(evidence.firstPageText);
  const identity = inferPaperIdentityMetadataFromPdfText(evidence.firstPageText);
  const identifiers: NonNullable<LiteratureResolveInput["hints"]>["identifiers"] = [];
  if (identity.doi) identifiers.push({ kind: "doi", value: identity.doi });
  if (identity.arxivId) identifiers.push({ kind: "arxiv_id", value: identity.arxivId });
  const embeddedTitle = evidence.embeddedTitle?.trim();
  const title = embeddedTitle && normalized(embeddedTitle).length >= 15 &&
    normalized(heading).includes(normalized(embeddedTitle)) ? embeddedTitle : undefined;
  // A bounded bibliographic query is only a search hint, never a title to save directly.
  const query = title ?? heading.replace(/\s+/g, " ").trim().slice(0, 350);
  if (!identifiers.length && normalized(query).length < 15) return undefined;
  return { purpose: "liteasy_pdf_annotation", limit: 5, query, hints: { identifiers, ...(title ? { title } : {}) } };
}

export function selectPdfRecognitionCandidate(
  result: LiteratureResolveResult, evidence: PdfRecognitionEvidence
): LiteratureCandidate | undefined {
  if (result.status !== "exact" && result.status !== "ambiguous") return undefined;
  const heading = normalized(headingText(evidence.firstPageText));
  const identity = inferPaperIdentityMetadataFromPdfText(evidence.firstPageText);
  const candidates = result.status === "exact" ? [result.candidate] : result.candidates;
  const matches = candidates.filter(({ record }) => {
    if (identity.arxivId && !record.identifiers.some((id) => id.kind === "arxiv_id" &&
      (/v\d+$/.test(identity.arxivId!) ? id.value === identity.arxivId : id.value.replace(/v\d+$/, "") === identity.arxivId))) return false;
    const title = normalized(record.title);
    if (title.length < 15 || !heading.includes(title)) return false;
    if (result.status === "exact") return true;
    // Title searches must also agree with a creator on the first page.
    return record.authors.some((author) => {
      const family = normalized(author.includes(",") ? author.split(",")[0] : author.trim().split(/\s+/).at(-1) ?? "");
      return family.length >= 3 && heading.includes(family);
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function buildMetadataPdfFileName(record: { title: string; authors: readonly string[]; year?: number }) {
  const author = record.authors[0];
  let name = [author ? `${author}${record.authors.length > 1 ? " et al." : ""}` : "", record.year, record.title]
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
