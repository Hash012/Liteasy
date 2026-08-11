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
  "openalex_id",
  "openreview_id",
  "dblp_key",
  "pmlr_id"
]);
const candidateLiteratureAliasKinds = new Set(["title_authors_year_hash"]);
const maxPmlrArtifactBytes = 20 * 1024 * 1024;
const versionDefiningIdentifierKinds = new Set([
  "doi",
  "arxiv_id",
  "openreview_id",
  "pmlr_id"
]);

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
  for (const kind of versionDefiningIdentifierKinds) {
    const leftValues = new Set((left?.identifiers ?? [])
      .filter((identifier) => identifier.kind === kind)
      .map((identifier) => normalizeLiteratureIdentifier(kind, identifier.value)));
    const rightValues = new Set((right?.identifiers ?? [])
      .filter((identifier) => identifier.kind === kind)
      .map((identifier) => normalizeLiteratureIdentifier(kind, identifier.value)));
    if (leftValues.size > 0 && rightValues.size > 0 &&
      ![...leftValues].some((value) => rightValues.has(value))) return false;
  }
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

export function normalizeLiteratureSourceEvidence(candidate) {
  if (candidate?.provider !== "pmlr") return null;
  const primary = candidate?.record?.identifiers?.[0];
  if (primary?.kind !== "pmlr_id") return null;
  let identifier;
  try {
    identifier = normalizeLiteratureIdentifier("pmlr_id", primary.value);
  } catch {
    return null;
  }
  const evidence = candidate.sourceEvidence;
  const volume = Number(/^v(\d{1,4})\//.exec(identifier)?.[1]);
  try {
    const artifactUrl = new URL(evidence?.artifactUrl);
    const recordUrl = new URL(candidate.recordUrl);
    if (artifactUrl.protocol !== "https:" || artifactUrl.hostname !== "proceedings.mlr.press" ||
      artifactUrl.username || artifactUrl.password ||
      artifactUrl.search || artifactUrl.hash ||
      !artifactUrl.pathname.endsWith(`/v${volume}/assets/bib/bibliography.bib`) ||
      recordUrl.toString() !== `https://proceedings.mlr.press/${identifier}.html` ||
      !/^sha256:[a-f0-9]{64}$/.test(String(evidence?.artifactHash ?? "")) ||
      evidence?.sourceKind !== "official_volume_bibtex" || evidence?.volume !== volume ||
      evidence?.entryKey !== `pmlr-${identifier.replace("/", "-")}`) return null;
    return { ...evidence, artifactUrl: artifactUrl.toString() };
  } catch {
    return null;
  }
}

export function attachLiteratureSourceArtifact(candidate, sourceArtifact) {
  if (!candidate || !sourceArtifact) return candidate;
  Object.defineProperty(candidate, "sourceArtifact", {
    configurable: false,
    enumerable: false,
    value: sourceArtifact,
    writable: false
  });
  return candidate;
}

export function normalizeLiteratureSourceArtifact(candidate) {
  const evidence = normalizeLiteratureSourceEvidence(candidate);
  const artifact = candidate?.sourceArtifact;
  if (!evidence || !artifact || artifact.mediaType !== "application/x-bibtex") return null;
  const content = Buffer.isBuffer(artifact.content)
    ? artifact.content
    : artifact.content instanceof Uint8Array ? Buffer.from(artifact.content) : null;
  if (!content || content.byteLength === 0 || content.byteLength > maxPmlrArtifactBytes) return null;
  const artifactHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (artifactHash !== evidence.artifactHash || artifact.artifactUrl !== evidence.artifactUrl) return null;
  return {
    artifactHash,
    artifactUrl: evidence.artifactUrl,
    byteLength: content.byteLength,
    content,
    mediaType: artifact.mediaType
  };
}

export function normalizeLiteratureIdentifier(kind, value) {
  const normalized = requiredIdentity(value);
  if (kind === "doi") {
    const identifier = normalized
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[.,;:]+$/, "")
      .toLocaleLowerCase("en-US");
    if (identifier.length > 1_000 || !/^10\.\d{4,9}\/[^\s?#]+$/u.test(identifier)) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return identifier;
  }
  if (kind === "arxiv_id") {
    const identifier = normalized
      .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
      .replace(/^arxiv:\s*/i, "")
      .replace(/\.pdf$/i, "")
      .toLocaleLowerCase("en-US");
    if (!/^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/.test(identifier)) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return identifier;
  }
  if (kind === "semantic_scholar_id") {
    const identifier = normalized
      .replace(/^corpusid\s*:\s*/i, "corpus:")
      .replace(/\s*:\s*/g, ":")
      .toLocaleLowerCase("en-US");
    if (!/^(?:corpus:[1-9]\d*|[a-f0-9]{40})$/.test(identifier)) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return identifier;
  }
  if (kind === "openalex_id") {
    const workId = normalized.replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, "");
    if (!/^w\d+$/i.test(workId)) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    return workId.toUpperCase();
  }
  if (kind === "openreview_id") {
    let noteId = normalized.replace(/^openreview:\s*/i, "");
    try {
      const url = new URL(noteId);
      if (!new Set(["openreview.net", "www.openreview.net", "api.openreview.net", "api2.openreview.net"]).has(url.hostname)) {
        throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
      }
      noteId = url.searchParams.get("id") ?? "";
    } catch (error) {
      if (error instanceof LiteratureIdentityConflictError) throw error;
    }
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(noteId)) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return noteId;
  }
  if (kind === "dblp_key") {
    let key = normalized
      .replace(/^https?:\/\/(?:www\.)?dblp\.org\/rec\//i, "")
      .replace(/\.(?:html|xml|json)$/i, "");
    try {
      key = decodeURIComponent(key);
    } catch {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    if (!/^(?:conf|journals)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+$/.test(key) || key.includes("..")) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return key;
  }
  if (kind === "pmlr_id") {
    let identifier = normalized.replace(/^pmlr:\s*/i, "");
    try {
      const url = new URL(identifier);
      if (!new Set(["proceedings.mlr.press", "www.proceedings.mlr.press"]).has(url.hostname)) {
        throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
      }
      identifier = url.pathname.replace(/^\/+/, "").replace(/\.html$/i, "");
    } catch (error) {
      if (error instanceof LiteratureIdentityConflictError) throw error;
    }
    identifier = identifier.replace(/^pmlr-v(\d{1,4})-/i, "v$1/").toLocaleLowerCase("en-US");
    if (!/^v[1-9]\d{0,3}\/[a-z0-9][a-z0-9._-]{0,199}$/.test(identifier) || identifier.includes("..")) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return identifier;
  }
  if (kind === "title_authors_year_hash") {
    const identifier = normalized.toLocaleLowerCase("en-US");
    if (!/^(?:sha256:[a-f0-9]{64}|[a-f0-9]{8})$/.test(identifier)) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
    }
    return identifier;
  }
  throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
}

export function isVersionSpecificArxivIdentifier(value) {
  try {
    return /v[1-9]\d*$/.test(normalizeLiteratureIdentifier("arxiv_id", value));
  } catch {
    return false;
  }
}

export function isConcreteConfirmableLiteratureIdentifier(identifier) {
  if (!identifier || !isConfirmableLiteratureIdentifierKind(identifier.kind) ||
    (identifier.role !== undefined && identifier.role !== "confirmable") ||
    identifier.isLegacyAlias === true || identifier.is_legacy_alias === true ||
    identifier.isLegacyAlias === 1 || identifier.is_legacy_alias === 1) return false;
  try {
    const value = normalizeLiteratureIdentifier(identifier.kind, identifier.value);
    return identifier.kind !== "arxiv_id" || isVersionSpecificArxivIdentifier(value);
  } catch {
    return false;
  }
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
    semantic_scholar: ["doi", "arxiv_id", "semantic_scholar_id"],
    openreview: ["doi", "openreview_id"],
    dblp: ["doi", "dblp_key"],
    pmlr: ["pmlr_id", "doi"]
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
    if (!literatureRelationDirections.has(direction) || !literatureRelationTypes.has(relationType) ||
      !isConfirmableLiteratureIdentifierKind(targetKind)) continue;
    let targetValue;
    try {
      targetValue = normalizeLiteratureIdentifier(targetKind, relation.targetIdentifier.value);
    } catch {
      continue;
    }
    if (targetKind === "arxiv_id" && !isVersionSpecificArxivIdentifier(targetValue)) continue;
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
