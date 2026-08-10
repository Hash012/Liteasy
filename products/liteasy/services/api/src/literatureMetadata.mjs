const identifierKinds = new Set([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id",
  "title_authors_year_hash"
]);
const providers = new Set(["intuecho", "openalex", "crossref", "arxiv", "semantic_scholar"]);

export class LiteratureMetadataValidationError extends Error {
  constructor() {
    super("literature_metadata_invalid");
    this.code = "literature_metadata_invalid";
  }
}

function invalid() {
  throw new LiteratureMetadataValidationError();
}

function plainObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (Object.keys(value).some((key) => !keys.has(key))) invalid();
  return value;
}

function text(value, maximum) {
  if (typeof value !== "string") invalid();
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum) invalid();
  return normalized;
}

function optionalText(value, maximum) {
  return value === undefined ? undefined : text(value, maximum);
}

function confirmedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid();
  return date.toISOString();
}

export function normalizeLiteratureIdentifier(kind, value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) invalid();
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
    if (!/^w\d+$/i.test(workId)) invalid();
    return workId.toUpperCase();
  }
  if (kind === "title_authors_year_hash") return normalized.toLocaleLowerCase("en-US");
  invalid();
}

export function normalizeLiteratureMetadata(value) {
  const record = plainObject(value, new Set([
    "authors", "documentType", "identifiers", "literatureId", "provenance", "revision", "status", "title", "year"
  ]));
  if (!Array.isArray(record.authors) || record.authors.length > 200) invalid();
  if (!Array.isArray(record.identifiers) || record.identifiers.length < 1 || record.identifiers.length > 20) invalid();
  const provenance = plainObject(record.provenance, new Set(["confirmedAt", "mode", "provider"]));
  if (provenance.mode !== "public_registry" || record.status !== "confirmed" || !Number.isSafeInteger(record.revision) || record.revision < 1) invalid();
  if (provenance.provider !== undefined && !providers.has(provenance.provider)) invalid();
  const normalizedIdentifiers = record.identifiers.map((value) => {
    const identifier = plainObject(value, new Set(["kind", "source", "value"]));
    if (!identifierKinds.has(identifier.kind) || identifier.source !== "public_registry") invalid();
    return {
      kind: identifier.kind,
      source: identifier.source,
      value: normalizeLiteratureIdentifier(identifier.kind, text(identifier.value, 1000))
    };
  });
  if (normalizedIdentifiers.every((identifier) => identifier.kind === "title_authors_year_hash")) invalid();
  if (record.year !== undefined && (!Number.isInteger(record.year) || record.year < 1000 || record.year > 9999)) invalid();
  const normalizedDocumentType = optionalText(record.documentType, 100);
  return {
    authors: record.authors.map((author) => text(author, 300)),
    ...(normalizedDocumentType ? { documentType: normalizedDocumentType } : {}),
    identifiers: normalizedIdentifiers,
    literatureId: text(record.literatureId, 200),
    provenance: {
      confirmedAt: confirmedAt(provenance.confirmedAt),
      mode: provenance.mode,
      ...(provenance.provider ? { provider: provenance.provider } : {})
    },
    revision: record.revision,
    status: "confirmed",
    title: text(record.title, 1000),
    ...(record.year === undefined ? {} : { year: record.year })
  };
}

export function normalizeLiteratureProjectionReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) invalid();
  return {
    literatureId: text(value.literatureId, 200),
    revision: value.revision
  };
}
