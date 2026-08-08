const validIdentifierKinds = new Set([
  "doi",
  "arxiv",
  "semantic_scholar",
  "openalex",
  "crossref",
  "local",
  "title_authors_year_hash"
]);

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validateIdentity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "invalid_work_identity" };
  }
  const kind = normalizeText(input.kind);
  const value = normalizeText(input.value);
  if (!validIdentifierKinds.has(kind)) {
    return { error: "invalid_work_identity_kind" };
  }
  if (!value || value.length > 512) {
    return { error: "invalid_work_identity_value" };
  }
  return { value: { kind, value } };
}

export function buildWorkResolutionRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_work_resolution_request" };
  }

  const rawIdentities = Array.isArray(body.identities) ? body.identities : [];
  if (rawIdentities.length === 0 || rawIdentities.length > 32) {
    return { error: "invalid_work_identity_count" };
  }

  const identities = [];
  for (const raw of rawIdentities) {
    const result = validateIdentity(raw);
    if (result.error) {
      return { error: result.error };
    }
    const relation = normalizeText(raw.relation);
    const sourceProvider = normalizeText(raw.sourceProvider || raw.source);
    identities.push({
      kind: result.value.kind,
      relation: relation || undefined,
      sourceProvider: sourceProvider || undefined,
      value: result.value.value,
      verified: raw.verified === true
    });
  }

  const year = Number.isInteger(body.year) ? body.year : null;
  const title = normalizeText(body.title) || null;
  const type = normalizeText(body.type) || null;
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

  return { value: { identities, meta: { metadata, title, type, year } } };
}

export function buildWorkResolutionSnapshot(resolution, personalizationVersion = 0) {
  return {
    created: resolution.created,
    identifiers: resolution.identifiers,
    personalizationVersion,
    work: resolution.work
  };
}
