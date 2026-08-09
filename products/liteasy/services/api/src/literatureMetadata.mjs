const identifierKinds = new Set([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id",
  "title_authors_year_hash"
]);
const sources = new Set(["public_registry", "manual", "inferred"]);
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

export function normalizeLiteratureMetadata(value) {
  const record = plainObject(value, new Set([
    "authors", "documentType", "identifiers", "literatureId", "provenance", "title", "year"
  ]));
  if (!Array.isArray(record.authors) || record.authors.length > 200) invalid();
  if (!Array.isArray(record.identifiers) || record.identifiers.length < 1 || record.identifiers.length > 20) invalid();
  const provenance = plainObject(record.provenance, new Set(["confirmedAt", "mode", "provider"]));
  if (!new Set(["public_registry", "manual"]).has(provenance.mode)) invalid();
  if (provenance.provider !== undefined && !providers.has(provenance.provider)) invalid();
  const normalizedIdentifiers = record.identifiers.map((value) => {
    const identifier = plainObject(value, new Set(["kind", "source", "value"]));
    if (!identifierKinds.has(identifier.kind) || !sources.has(identifier.source)) invalid();
    if (identifier.source !== provenance.mode) invalid();
    return {
      kind: identifier.kind,
      source: identifier.source,
      value: text(identifier.value, 1000)
    };
  });
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
    title: text(record.title, 1000),
    ...(record.year === undefined ? {} : { year: record.year })
  };
}
