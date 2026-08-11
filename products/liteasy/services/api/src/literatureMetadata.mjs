const identifierKinds = new Set([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "openalex_id",
  "openreview_id",
  "dblp_key",
  "pmlr_id",
  "title_authors_year_hash"
]);
const identifierRoles = new Set(["confirmable", "candidate_alias"]);
const providers = new Set([
  "intuecho",
  "openalex",
  "crossref",
  "arxiv",
  "semantic_scholar",
  "openreview",
  "dblp",
  "pmlr"
]);

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
    const identifier = normalized
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[.,;:]+$/, "")
      .toLocaleLowerCase("en-US");
    if (identifier.length > 1_000 || !/^10\.\d{4,9}\/[^\s?#]+$/u.test(identifier)) invalid();
    return identifier;
  }
  if (kind === "arxiv_id") {
    const identifier = normalized
      .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
      .replace(/^arxiv:\s*/i, "")
      .replace(/\.pdf$/i, "")
      .toLocaleLowerCase("en-US");
    if (!/^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/.test(identifier)) invalid();
    return identifier;
  }
  if (kind === "semantic_scholar_id") {
    const identifier = normalized
      .replace(/^corpusid\s*:\s*/i, "corpus:")
      .replace(/\s*:\s*/g, ":")
      .toLocaleLowerCase("en-US");
    if (!/^(?:corpus:[1-9]\d*|[a-f0-9]{40})$/.test(identifier)) invalid();
    return identifier;
  }
  if (kind === "openalex_id") {
    const workId = normalized.replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, "");
    if (!/^w\d+$/i.test(workId)) invalid();
    return workId.toUpperCase();
  }
  if (kind === "openreview_id") {
    let noteId = normalized.replace(/^openreview:\s*/i, "");
    try {
      const url = new URL(noteId);
      if (!new Set(["openreview.net", "www.openreview.net", "api.openreview.net", "api2.openreview.net"]).has(url.hostname)) invalid();
      noteId = url.searchParams.get("id") ?? "";
    } catch (error) {
      if (error instanceof LiteratureMetadataValidationError) throw error;
    }
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(noteId)) invalid();
    return noteId;
  }
  if (kind === "dblp_key") {
    let key = normalized
      .replace(/^https?:\/\/(?:www\.)?dblp\.org\/rec\//i, "")
      .replace(/\.(?:html|xml|json)$/i, "");
    try {
      key = decodeURIComponent(key);
    } catch {
      invalid();
    }
    if (!/^(?:conf|journals)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+$/.test(key) || key.includes("..")) invalid();
    return key;
  }
  if (kind === "pmlr_id") {
    let identifier = normalized.replace(/^pmlr:\s*/i, "");
    try {
      const url = new URL(identifier);
      if (!new Set(["proceedings.mlr.press", "www.proceedings.mlr.press"]).has(url.hostname)) invalid();
      identifier = url.pathname.replace(/^\/+/, "").replace(/\.html$/i, "");
    } catch (error) {
      if (error instanceof LiteratureMetadataValidationError) throw error;
    }
    identifier = identifier.replace(/^pmlr-v(\d{1,4})-/i, "v$1/").toLocaleLowerCase("en-US");
    if (!/^v[1-9]\d{0,3}\/[a-z0-9][a-z0-9._-]{0,199}$/.test(identifier) || identifier.includes("..")) invalid();
    return identifier;
  }
  if (kind === "title_authors_year_hash") {
    const identifier = normalized.toLocaleLowerCase("en-US");
    if (!/^(?:sha256:[a-f0-9]{64}|[a-f0-9]{8})$/.test(identifier)) invalid();
    return identifier;
  }
  invalid();
}

function literatureIdentifierRole(kind) {
  return kind === "title_authors_year_hash" ? "candidate_alias" : "confirmable";
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
    const identifier = plainObject(value, new Set(["kind", "role", "source", "value"]));
    if (!identifierKinds.has(identifier.kind)) invalid();
    const role = literatureIdentifierRole(identifier.kind);
    if (identifier.role !== undefined && (!identifierRoles.has(identifier.role) || identifier.role !== role)) invalid();
    if (role === "confirmable" && identifier.source !== "public_registry") invalid();
    if (role === "candidate_alias" && identifier.source !== "metadata" && identifier.source !== "public_registry") invalid();
    const normalizedValue = normalizeLiteratureIdentifier(identifier.kind, text(identifier.value, 1000));
    if (identifier.kind === "arxiv_id" && !/v[1-9]\d*$/.test(normalizedValue)) invalid();
    return {
      kind: identifier.kind,
      role,
      source: role === "candidate_alias" ? "metadata" : "public_registry",
      value: normalizedValue
    };
  });
  if (normalizedIdentifiers.every((identifier) => identifier.role === "candidate_alias")) invalid();
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
