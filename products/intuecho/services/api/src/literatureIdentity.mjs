import { createHash } from "node:crypto";

const canonicalKindOrder = [
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id",
  "title_authors_year_hash"
];

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

function requiredIdentity(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
  return normalized;
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
      .replace(/^arxiv:\s*/i, "")
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
    return normalized.replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, "");
  }
  if (kind === "title_authors_year_hash") return normalized.toLocaleLowerCase("en-US");
  return normalized;
}

export function titleAuthorsYearFingerprint(input) {
  const title = normalizeBibliographicText(input?.title);
  const authors = Array.isArray(input?.authors) ? input.authors.map(normalizeBibliographicText) : [];
  const year = input?.year;
  if (!title || authors.length === 0 || authors.some((author) => !author) || !Number.isInteger(year)) {
    throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
  }
  const digest = createHash("sha256").update(JSON.stringify({ authors, title, year })).digest("hex");
  return `sha256:${digest}`;
}

export function canonicalLiteratureKey(record) {
  const identifiers = Array.isArray(record?.identifiers) ? record.identifiers : [];
  for (const kind of canonicalKindOrder) {
    const identifier = identifiers.find((item) => item.kind === kind);
    if (identifier) return `${kind}:${normalizeLiteratureIdentifier(kind, identifier.value)}`;
  }
  throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
}

export function mergeLiteratureRecords(records) {
  const owners = new Map();
  for (const record of records) {
    for (const identifier of record.identifiers) {
      const key = `${identifier.kind}:${normalizeLiteratureIdentifier(identifier.kind, identifier.value)}`;
      const owner = owners.get(key);
      if (owner && owner !== record.literatureId) {
        throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      }
      owners.set(key, record.literatureId);
    }
  }
  return Object.freeze(records.map((record) => Object.freeze(record)));
}
