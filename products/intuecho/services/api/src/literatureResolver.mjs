import {
  hasCrossVersionIdentifierConflict,
  isCandidateLiteratureAliasKind,
  isConfirmableLiteratureIdentifierKind,
  normalizeLiteratureIdentifier,
  normalizeLiteratureRelations,
  sameLiteratureVersionBibliography
} from "./literatureIdentity.mjs";

const MAX_CANDIDATES = 10;
const primaryRegistryProviders = new Set(["crossref", "arxiv"]);
const aggregateRegistryProviders = new Set(["openalex", "semantic_scholar"]);

export class LiteratureResolverError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "LiteratureResolverError";
  }
}

function normalizedIdentifierKey(identifier) {
  const normalized = normalizedIdentifier(identifier);
  return normalized ? `${normalized.kind}:${normalized.value}` : null;
}

function normalizedIdentifier(identifier) {
  if (!identifier?.kind || (!isConfirmableLiteratureIdentifierKind(identifier.kind) &&
    !isCandidateLiteratureAliasKind(identifier.kind))) return null;
  try {
    return { kind: identifier.kind, value: normalizeLiteratureIdentifier(identifier.kind, identifier.value) };
  } catch {
    return null;
  }
}

function normalizedIdentifiers(identifiers) {
  return [...new Map((Array.isArray(identifiers) ? identifiers : []).map((identifier) => {
    const key = normalizedIdentifierKey(identifier);
    return key ? [key, { ...identifier, value: key.slice(identifier.kind.length + 1) }] : null;
  }).filter(Boolean)).values()];
}

function displayRecord(record) {
  const title = String(record?.title ?? "").trim();
  const identifiers = normalizedIdentifiers(record?.identifiers);
  if (!title || identifiers.length === 0) return null;
  const authors = (Array.isArray(record.authors) ? record.authors : []).map((author) => String(author ?? "").trim()).filter(Boolean).slice(0, 200);
  const year = Number(record.year);
  return {
    authors,
    ...(record.documentType ? { documentType: String(record.documentType).trim() } : {}),
    identifiers,
    title,
    ...(Number.isInteger(year) && year >= 1000 && year <= 9999 ? { year } : {})
  };
}

function internalCandidate(record) {
  const display = displayRecord(record);
  const literatureId = String(record?.literatureId ?? "").trim();
  if (!display || !literatureId) return null;
  return {
    candidateKey: `intuecho:${literatureId}`,
    provider: "intuecho",
    record: display
  };
}

function externalCandidate(value, providerName) {
  if (!value || value.provider !== providerName || typeof value.candidateKey !== "string" || !value.candidateKey.startsWith(`${providerName}:`)) {
    return null;
  }
  const record = displayRecord(value.record);
  const relations = normalizeLiteratureRelations(value.relations);
  const primary = record?.identifiers[0];
  if (!record || !primary || !isConfirmableLiteratureIdentifierKind(primary.kind) ||
    primary.source !== "public_registry" || hasCrossVersionIdentifierConflict(record)) return null;
  const expectedKey = `${providerName}:${primary.kind}:${primary.value}`;
  if (value.candidateKey !== expectedKey) return null;
  let recordUrl = null;
  try {
    const parsed = new URL(value.recordUrl);
    if (parsed.protocol === "https:") recordUrl = parsed.toString();
  } catch {
    // An optional source URL is discarded unless it is HTTPS.
  }
  return {
    candidateKey: expectedKey,
    provider: providerName,
    record,
    ...(relations.length ? { relations } : {}),
    ...(recordUrl ? { recordUrl } : {})
  };
}

function identityKeys(candidate) {
  return new Set(candidate.record.identifiers.map(normalizedIdentifierKey).filter(Boolean));
}

function sharesIdentity(left, right) {
  const leftKeys = identityKeys(left);
  return [...identityKeys(right)].some((key) => leftKeys.has(key));
}

function bibliographiesDoNotConflict(left, right) {
  if (left.provider === "intuecho" || right.provider === "intuecho") return true;
  const leftTitle = normalizeText(left.record.title);
  const rightTitle = normalizeText(right.record.title);
  if (leftTitle && rightTitle && leftTitle !== rightTitle) return false;
  if (left.record.year !== undefined && right.record.year !== undefined && left.record.year !== right.record.year) return false;
  const leftAuthors = left.record.authors.map(normalizeText).filter(Boolean).sort();
  const rightAuthors = right.record.authors.map(normalizeText).filter(Boolean).sort();
  return leftAuthors.length === 0 || rightAuthors.length === 0 || (
    leftAuthors.length === rightAuthors.length && leftAuthors.every((author, index) => author === rightAuthors[index])
  );
}

function attestsRequestedIdentity(candidate, requestedKeys) {
  return [...identityKeys(candidate)].some((key) => requestedKeys.has(key));
}

function selectRepresentative(left, right, requestedKeys) {
  const leftAttests = attestsRequestedIdentity(left, requestedKeys);
  const rightAttests = attestsRequestedIdentity(right, requestedKeys);
  if (leftAttests !== rightAttests) return rightAttests ? right : left;
  if (left.provider === "intuecho") return left;
  if (right.provider === "intuecho") return right;
  const leftPrimary = primaryRegistryProviders.has(left.provider);
  const rightPrimary = primaryRegistryProviders.has(right.provider);
  if (leftPrimary !== rightPrimary) return rightPrimary ? right : left;
  return left;
}

function rankAndDeduplicate(candidates, requestedKeys) {
  const ranked = [];
  for (const candidate of candidates) {
    const matching = ranked.map((existing, index) => sharesIdentity(existing, candidate) && bibliographiesDoNotConflict(existing, candidate)
      ? index
      : -1).filter((index) => index >= 0);
    if (matching.length === 0) {
      ranked.push(candidate);
      continue;
    }
    const matched = matching.map((index) => ranked[index]);
    let representative = matched[0];
    for (const item of matched) {
      if (item !== representative) representative = selectRepresentative(representative, item, requestedKeys);
    }
    representative = selectRepresentative(representative, candidate, requestedKeys);
    const retained = ranked.filter((_item, index) => !matching.includes(index));
    retained.splice(matching[0], 0, representative);
    ranked.splice(0, ranked.length, ...retained);
  }
  return ranked;
}

function hasIdentityConflict(candidates) {
  return candidates.some((candidate, index) => candidates.slice(index + 1).some((other) =>
    sharesIdentity(candidate, other) && !bibliographiesDoNotConflict(candidate, other)));
}

function corroboratedExternalCandidate(candidates, requestedKeys) {
  const externalCandidates = candidates.filter((candidate) => candidate.provider !== "intuecho");
  for (const [index, candidate] of externalCandidates.entries()) {
    for (const other of externalCandidates.slice(index + 1)) {
      if (candidate.provider === other.provider ||
        (!aggregateRegistryProviders.has(candidate.provider) && !aggregateRegistryProviders.has(other.provider)) ||
        !sameLiteratureVersionBibliography(candidate.record, other.record)) continue;
      return selectRepresentative(candidate, other, requestedKeys);
    }
  }
  return null;
}

function requestedLimit(input) {
  const requested = Number(input?.limit ?? MAX_CANDIDATES);
  return Math.max(1, Math.min(Number.isInteger(requested) ? requested : MAX_CANDIDATES, MAX_CANDIDATES));
}

function requestedLiteratureIdentifiers(input) {
  const identifiers = [];
  for (const identifier of input?.hints?.identifiers ?? []) {
    const normalized = normalizedIdentifier(identifier);
    if (normalized) identifiers.push(normalized);
  }
  const query = String(input?.query ?? "").trim();
  const candidates = [
    ["doi", /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/.+/i],
    ["arxiv_id", /^(?:https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?(?:\.pdf)?$/i],
    ["openalex_id", /^(?:https?:\/\/(?:www\.)?openalex\.org\/)?W\d+$/i],
    ["semantic_scholar_id", /^corpusid\s*:\s*.+$/i]
  ];
  for (const [kind, pattern] of candidates) {
    if (!pattern.test(query)) continue;
    const normalized = normalizedIdentifier({ kind, value: query });
    if (normalized) identifiers.push(normalized);
  }
  return [...new Map(identifiers.map((identifier) => [`${identifier.kind}:${identifier.value}`, identifier])).values()];
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function isPdfIdentityPurpose(input) {
  return input?.purpose === "liteasy_pdf_annotation";
}

function providerSupports(provider, capability, fallbackMethod) {
  if (Array.isArray(provider?.capabilities)) return provider.capabilities.includes(capability);
  return typeof provider?.[fallbackMethod] === "function";
}

function providerOperation(provider, capability) {
  if (capability === "resolveIdentity") return provider.resolveIdentity ?? provider.search;
  return provider.search;
}

function identityRelevantCandidate(input, candidate, requestedKeys) {
  if (!isPdfIdentityPurpose(input)) return true;
  if (requestedKeys.size > 0) return attestsRequestedIdentity(candidate, requestedKeys);
  const requestedTitle = normalizeText(input?.hints?.title);
  return Boolean(requestedTitle && normalizeText(candidate.record.title) === requestedTitle);
}

function exactCandidate(candidates, requestedConfirmableKeys) {
  const byIdentifier = candidates.filter((candidate) =>
    [...identityKeys(candidate)].some((key) => requestedConfirmableKeys.has(key)));
  if (byIdentifier.length === 1) return byIdentifier[0];
  return null;
}

function candidateKeyParts(candidateKey) {
  if (typeof candidateKey !== "string") return null;
  if (candidateKey.startsWith("intuecho:")) {
    const literatureId = candidateKey.slice("intuecho:".length);
    return literatureId && !literatureId.includes(":") ? { literatureId, provider: "intuecho" } : null;
  }
  const [provider, kind, ...valueParts] = candidateKey.split(":");
  const value = valueParts.join(":");
  if (!provider || !kind || !value) return null;
  try {
    return { kind, provider, value: normalizeLiteratureIdentifier(kind, value) };
  } catch {
    return null;
  }
}

function confirmationSearchInput(record) {
  return {
    hints: {
      ...(record.authors.length ? { authors: [...record.authors] } : {}),
      identifiers: record.identifiers.map(({ kind, value }) => ({ kind, value })),
      title: record.title,
      ...(record.year ? { year: record.year } : {})
    },
    limit: MAX_CANDIDATES,
    purpose: "liteasy_pdf_annotation"
  };
}

async function refetchCrossSourceCandidates(selected, configuredProviders) {
  const otherProviders = configuredProviders.filter((provider) => provider.name !== selected.provider &&
    providerSupports(provider, "resolveIdentity", "search") &&
    providerSupports(provider, "refetchForConfirmation", "fetchCandidate"));
  const searched = await Promise.allSettled(otherProviders.map(async (provider) => {
    const operation = providerOperation(provider, "resolveIdentity");
    const values = await operation.call(provider, confirmationSearchInput(selected.record));
    return (Array.isArray(values) ? values : [])
      .map((value) => externalCandidate(value, provider.name))
      .filter(Boolean)
      .filter((candidate) => sharesIdentity(selected, candidate) ||
        sameLiteratureVersionBibliography(selected.record, candidate.record));
  }));
  const discovered = searched.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (discovered.some((candidate) => sharesIdentity(selected, candidate) && !bibliographiesDoNotConflict(selected, candidate))) {
    throw new LiteratureResolverError("LITERATURE_IDENTITY_CONFLICT");
  }
  const byKey = new Map(discovered.map((candidate) => [candidate.candidateKey, candidate]));
  const refetched = await Promise.allSettled([...byKey.values()].map(async (candidate) => {
    const provider = otherProviders.find((item) => item.name === candidate.provider);
    const refetch = provider?.refetchForConfirmation ?? provider?.fetchCandidate;
    const value = await refetch.call(provider, candidate.candidateKey);
    return externalCandidate(value, candidate.provider);
  }));
  const verified = refetched.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (verified.some((candidate) => sharesIdentity(selected, candidate) && !bibliographiesDoNotConflict(selected, candidate))) {
    throw new LiteratureResolverError("LITERATURE_IDENTITY_CONFLICT");
  }
  return verified.filter((candidate) => sameLiteratureVersionBibliography(selected.record, candidate.record));
}

export function createLiteratureResolver({ providers, repository }) {
  const configuredProviders = Array.isArray(providers) ? [...providers] : [];
  if (!repository) throw new TypeError("repository is required");
  return Object.freeze({
    async resolve(owner, input) {
      const limit = requestedLimit(input);
      const query = input?.query ?? input?.hints?.title ?? input?.hints?.identifiers?.[0]?.value ?? "";
      const requestedIdentifiers = requestedLiteratureIdentifiers(input);
      const requestedKeys = new Set(requestedIdentifiers.map((identifier) => `${identifier.kind}:${identifier.value}`));
      const requestedConfirmableKeys = new Set(requestedIdentifiers
        .filter((identifier) => isConfirmableLiteratureIdentifierKind(identifier.kind))
        .map((identifier) => `${identifier.kind}:${identifier.value}`));
      let identifiedCandidate = null;
      if (requestedIdentifiers.length > 0) {
        const identified = await repository.findLiteratureByIdentifiers(requestedIdentifiers);
        identifiedCandidate = internalCandidate(identified);
        if (identifiedCandidate && attestsRequestedIdentity(identifiedCandidate, requestedConfirmableKeys)) {
          return { candidate: identifiedCandidate, confirmationMode: "candidate", status: "exact", unavailableProviders: [] };
        }
      }
      const stored = await repository.searchStoredLiterature(query, limit);
      const capability = isPdfIdentityPurpose(input) ? "resolveIdentity" : "search";
      const selectedProviders = configuredProviders.filter((provider) => providerSupports(provider, capability, "search"));
      const external = await Promise.allSettled(selectedProviders.map((provider) => {
        const operation = providerOperation(provider, capability);
        return operation.call(provider, input);
      }));
      const unavailableProviders = external.flatMap((result, index) => result.status === "rejected" ? [selectedProviders[index].name] : []);
      const providerCandidates = external.flatMap((result, index) => result.status === "fulfilled"
        ? (Array.isArray(result.value) ? result.value.map((candidate) => externalCandidate(candidate, selectedProviders[index].name)).filter(Boolean) : [])
        : []);
      const admittedCandidates = [
        ...(identifiedCandidate ? [identifiedCandidate] : []),
        ...(Array.isArray(stored) ? stored.map(internalCandidate).filter(Boolean) : []),
        ...providerCandidates
      ].filter((candidate) => identityRelevantCandidate(input, candidate, requestedKeys));
      if (hasIdentityConflict(admittedCandidates)) {
        return { candidates: admittedCandidates.slice(0, limit), status: "conflict", unavailableProviders };
      }
      const candidates = rankAndDeduplicate(admittedCandidates, requestedKeys).slice(0, limit);
      const exact = exactCandidate(candidates, requestedConfirmableKeys);
      if (exact && (exact.provider === "intuecho" || primaryRegistryProviders.has(exact.provider))) {
        return { candidate: exact, confirmationMode: "candidate", status: "exact", unavailableProviders };
      }
      const corroborated = corroboratedExternalCandidate(admittedCandidates, requestedKeys);
      if (corroborated) {
        return { candidate: corroborated, confirmationMode: "corroborated", status: "exact", unavailableProviders };
      }
      if (candidates.length) return { candidates, status: "ambiguous", unavailableProviders };
      if (selectedProviders.length > 0 && external.every((result) => result.status === "rejected")) {
        return { retryable: true, status: "unavailable", unavailableProviders };
      }
      return { candidates: [], status: "not_found", unavailableProviders };
    },

    async confirm(owner, input) {
      const parts = candidateKeyParts(input?.candidateKey);
      if (!parts) throw new LiteratureResolverError("LITERATURE_CANDIDATE_NOT_FOUND");
      if (parts.provider === "intuecho") {
        const stored = await repository.findLiteratureById(parts.literatureId);
        if (!stored) throw new LiteratureResolverError("LITERATURE_CANDIDATE_NOT_FOUND");
        return stored;
      }
      const provider = configuredProviders.find((item) => item.name === parts.provider &&
        providerSupports(item, "refetchForConfirmation", "fetchCandidate"));
      const refetch = provider?.refetchForConfirmation ?? provider?.fetchCandidate;
      if (!provider || typeof refetch !== "function") {
        throw new LiteratureResolverError("LITERATURE_CANDIDATE_NOT_FOUND");
      }
      let verified;
      try {
        verified = await refetch.call(provider, input.candidateKey);
      } catch {
        throw new LiteratureResolverError("LITERATURE_PROVIDER_UNAVAILABLE");
      }
      const candidate = externalCandidate(verified, parts.provider);
      if (!candidate || candidate.candidateKey !== input.candidateKey) {
        throw new LiteratureResolverError("LITERATURE_CANDIDATE_NOT_FOUND");
      }
      const corroborations = input.mode === "corroborated" || aggregateRegistryProviders.has(candidate.provider)
        ? await refetchCrossSourceCandidates(candidate, configuredProviders)
        : [];
      if (input.mode === "corroborated" && corroborations.length === 0) {
        throw new LiteratureResolverError("LITERATURE_CORROBORATION_REQUIRED");
      }
      return repository.confirmRefetchedLiterature(owner, {
        candidateKey: candidate.candidateKey,
        provider: candidate.provider,
        record: candidate.record,
        ...(corroborations.length ? { corroborations } : {}),
        ...(candidate.relations ? { relations: candidate.relations } : {}),
        ...(candidate.recordUrl ? { recordUrl: candidate.recordUrl } : {})
      });
    },

    async verifyProjection(literatureId, revision) {
      return repository.verifyLiteratureProjection(literatureId, revision);
    },

    async relations(literatureId) {
      const current = await repository.findLiteratureById(literatureId);
      if (!current) throw new LiteratureResolverError("LITERATURE_CANDIDATE_NOT_FOUND");
      const relations = await repository.findLiteratureRelations(literatureId);
      const versions = [];
      for (const relation of relations) {
        const direction = relation.fromLiteratureId === literatureId ? "from_current" : "to_current";
        const relatedLiteratureId = direction === "from_current"
          ? relation.toLiteratureId
          : relation.fromLiteratureId;
        const literature = await repository.findLiteratureById(relatedLiteratureId);
        if (literature) versions.push({ direction, literature, relation });
      }
      return { literatureId, versions };
    }
  });
}
