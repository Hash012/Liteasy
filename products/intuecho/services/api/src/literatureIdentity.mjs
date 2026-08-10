import { createHash } from "node:crypto";

export class LiteratureIdentityConflictError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "LiteratureIdentityConflictError";
  }
}

function normalizeBibliographicText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function normalizeBibliographicAuthor(value) {
  const source = String(value ?? "").normalize("NFKC");
  const parts = source.split(",").map((part) => part.trim()).filter(Boolean);
  return normalizeBibliographicText(parts.length === 2 ? `${parts[1]} ${parts[0]}` : source);
}

const publicationDocumentTypes = new Set([
  "article",
  "book-chapter",
  "conference-paper",
  "conference_paper",
  "journal-article",
  "proceedings-article",
  "publication"
]);
const literatureRelationDirections = new Set(["from_current", "to_current"]);
const literatureRelationTypes = new Set(["is_preprint_of", "translation_of", "version_of"]);
const confirmableLiteratureIdentifierKinds = new Set([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id"
]);
const candidateLiteratureAliasKinds = new Set(["title_authors_year_hash"]);

const preprintDocumentTypes = new Set([
  "posted-content",
  "preprint",
  "working-paper",
  "working_paper"
]);

function literatureVersionClass(record) {
  const documentType = String(record?.documentType ?? "").trim().toLocaleLowerCase("en-US");
  if (publicationDocumentTypes.has(documentType)) return "publication";
  if (preprintDocumentTypes.has(documentType)) return "preprint";
  return null;
}

export function normalizeLiteratureBibliography(input) {
  const title = normalizeBibliographicText(input?.title);
  const authors = Array.isArray(input?.authors)
    ? [...new Set(input.authors.map(normalizeBibliographicAuthor).filter(Boolean))].sort()
    : [];
  const year = Number.isInteger(input?.year) ? input.year : undefined;
  return { authors, title, ...(year === undefined ? {} : { year }) };
}

export function sameLiteratureBibliography(left, right) {
  const leftNormalized = normalizeLiteratureBibliography(left);
  const rightNormalized = normalizeLiteratureBibliography(right);
  return Boolean(leftNormalized.title && leftNormalized.authors.length > 0 && leftNormalized.year !== undefined &&
    leftNormalized.title === rightNormalized.title &&
    leftNormalized.year === rightNormalized.year &&
    JSON.stringify(leftNormalized.authors) === JSON.stringify(rightNormalized.authors));
}

export function sameLiteratureVersionBibliography(left, right) {
  if (!sameLiteratureBibliography(left, right)) return false;
  const leftVersion = literatureVersionClass(left);
  const rightVersion = literatureVersionClass(right);
  if (!leftVersion || !rightVersion || leftVersion !== rightVersion) return false;
  const identifiers = [...(left?.identifiers ?? []), ...(right?.identifiers ?? [])];
  return !hasCrossVersionIdentifierConflict({
    documentType: leftVersion === "publication" || rightVersion === "publication"
      ? "publication"
      : leftVersion === "preprint" || rightVersion === "preprint"
        ? "preprint"
        : undefined,
    identifiers
  });
}

export function hasCrossVersionIdentifierConflict(record) {
  const documentType = String(record?.documentType ?? "").trim().toLocaleLowerCase("en-US");
  if (!publicationDocumentTypes.has(documentType)) return false;
  const identifiers = Array.isArray(record?.identifiers) ? record.identifiers : [];
  const hasArxiv = identifiers.some((identifier) => identifier.kind === "arxiv_id");
  const hasFormalDoi = identifiers.some((identifier) => identifier.kind === "doi" &&
    !normalizeLiteratureIdentifier("doi", identifier.value).startsWith("10.48550/arxiv."));
  return hasArxiv && hasFormalDoi;
}

function requiredIdentity(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
  return normalized;
}

export function isConfirmableLiteratureIdentifierKind(kind) {
  return confirmableLiteratureIdentifierKinds.has(kind);
}

export function isCandidateLiteratureAliasKind(kind) {
  return candidateLiteratureAliasKinds.has(kind);
}

export function literatureIdentifierRole(kind) {
  if (isConfirmableLiteratureIdentifierKind(kind)) return "confirmable";
  if (isCandidateLiteratureAliasKind(kind)) return "candidate_alias";
  throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
}

export function normalizeLiteratureIdentifier(kind, value) {
  const normalized = requiredIdentity(value);
  if (kind === "doi") {
    return normalized
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[.,;:]+$/, "")
      .toLocaleLowerCase("en-US");
  }
  if (kind === "arxiv_id") {
    return normalized
      .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
      .replace(/^arxiv:\s*/i, "")
      .replace(/\.pdf$/i, "")
      .replace(/v\d+$/i, "")
      .toLocaleLowerCase("en-US");
  }
  if (kind === "semantic_scholar_id") {
    return normalized
      .replace(/^corpusid\s*:\s*/i, "corpus:")
      .replace(/\s*:\s*/g, ":")
      .toLocaleLowerCase("en-US");
  }
  if (kind === "openalex_id") {
    const workId = normalized.replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, "");
    if (!/^w\d+$/i.test(workId)) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    return workId.toUpperCase();
  }
  if (kind === "title_authors_year_hash") return normalized.toLocaleLowerCase("en-US");
  return normalized;
}

export function selectLiteratureClaimIdentifier(identifiers, provider) {
  const normalized = (Array.isArray(identifiers) ? identifiers : []).map((identifier) => ({
    ...identifier,
    value: normalizeLiteratureIdentifier(identifier.kind, identifier.value)
  }));
  const preferredKinds = {
    arxiv: ["arxiv_id"],
    crossref: ["doi"],
    openalex: ["doi", "arxiv_id", "openalex_id"],
    semantic_scholar: ["doi", "arxiv_id", "semantic_scholar_id"]
  }[provider] ?? [];
  for (const kind of preferredKinds) {
    const identifier = normalized.find((item) => item.kind === kind);
    if (identifier) return identifier;
  }
  return normalized[0] ?? null;
}

export function normalizeLiteratureRelations(relations) {
  const normalized = [];
  const seen = new Set();
  for (const relation of Array.isArray(relations) ? relations : []) {
    const direction = String(relation?.direction ?? "").trim();
    const relationType = String(relation?.relationType ?? "").trim();
    const targetKind = String(relation?.targetIdentifier?.kind ?? "").trim();
    if (!literatureRelationDirections.has(direction) || !literatureRelationTypes.has(relationType) || !targetKind) continue;
    let targetValue;
    try {
      targetValue = normalizeLiteratureIdentifier(targetKind, relation.targetIdentifier.value);
    } catch {
      continue;
    }
    const evidence = relation?.evidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Object.keys(evidence).length === 0) continue;
    const key = `${direction}:${relationType}:${targetKind}:${targetValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      direction,
      evidence: { ...evidence },
      relationType,
      targetIdentifier: { kind: targetKind, value: targetValue }
    });
  }
  return normalized;
}

export function titleAuthorsYearFingerprint(input) {
  const title = normalizeBibliographicText(input?.title);
  const authors = Array.isArray(input?.authors)
    ? [...new Set(input.authors.map(normalizeBibliographicAuthor).filter(Boolean))].sort()
    : [];
  const year = input?.year;
  if (!title || authors.length === 0 || authors.some((author) => !author) || !Number.isInteger(year)) {
    throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
  }
  const digest = createHash("sha256").update(JSON.stringify({ authors, title, year })).digest("hex");
  return `sha256:${digest}`;
}

export function isLegacyTitleAuthorsYearHash(value) {
  return typeof value === "string" && /^[a-f0-9]{8}$/i.test(value.trim());
}
