import { createHash } from "node:crypto";

const generatedModalities = new Set([
  "semantic_graph", "circuit", "physics_diagram", "biology_structure",
  "geometry_2d", "function_plot", "geometry_3d", "physics_process",
  "reaction_process", "raster_illustration"
]);
const purposes = new Set(["explain_structure", "compare", "show_process", "show_geometry", "show_evidence"]);
const requestedByValues = new Set(["automatic", "explicit_user_request"]);
const learningGains = new Set(["low", "medium", "high"]);
const identifierPattern = /^[A-Za-z0-9._:-]+$/;
const maximumEvidenceBytes = 128 * 1024;

export class ThinReadingVisualizationSourceError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function fail(code = "thin_reading_visualization_source_invalid", status) {
  throw new ThinReadingVisualizationSourceError(code, status);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function boundedText(value, maximum, code = "thin_reading_visualization_source_invalid") {
  if (typeof value !== "string") fail(code);
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum) fail(code);
  return normalized;
}

function identifier(value, maximum = 160) {
  const normalized = boundedText(value, maximum);
  if (!identifierPattern.test(normalized)) fail();
  return normalized;
}

function exactFields(value, allowed) {
  const object = record(value);
  if (!object || Object.keys(object).some((key) => !allowed.has(key))) fail();
  return object;
}

function uniqueStrings(value, minimum, maximum, itemMaximum = 160) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail();
  const normalized = value.map((item) => identifier(item, itemMaximum));
  if (new Set(normalized).size !== normalized.length) fail();
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function normalizeIntent(value, nodeId) {
  const intent = exactFields(value, new Set([
    "candidateModalities", "evidenceIds", "expectedLearningGain", "nodeId", "purpose", "requestedBy"
  ]));
  const candidateModalities = uniqueStrings(intent.candidateModalities, 1, 3, 80);
  if (candidateModalities.some((modality) => !generatedModalities.has(modality))) fail();
  const evidenceIds = uniqueStrings(intent.evidenceIds, 1, 256, 160);
  const expectedLearningGain = boundedText(intent.expectedLearningGain, 16);
  const requestedBy = boundedText(intent.requestedBy, 32);
  const purpose = boundedText(intent.purpose, 32);
  if (identifier(intent.nodeId, 160) !== nodeId || !learningGains.has(expectedLearningGain) ||
    !requestedByValues.has(requestedBy) || !purposes.has(purpose)) fail();
  return { candidateModalities, evidenceIds, expectedLearningGain, nodeId, purpose, requestedBy };
}

function paperEvidence(spans, requestedEvidenceIds) {
  if (!Array.isArray(spans)) return [];
  const requested = new Set(requestedEvidenceIds);
  return spans.flatMap((candidate) => {
    const span = record(candidate);
    if (!span || !requested.has(span.id)) return [];
    const evidence = {
      id: identifier(span.id, 160),
      kind: "paper",
      paperId: identifier(span.paperId, 160),
      quote: boundedText(span.quote, 16_384)
    };
    if (span.page !== undefined) {
      if (!Number.isSafeInteger(span.page) || span.page < 1 || span.page > 1_000_000) fail();
      evidence.page = span.page;
    }
    return [evidence];
  });
}

function externalEvidence(sources, requestedEvidenceIds) {
  if (!Array.isArray(sources)) return [];
  const requested = new Set(requestedEvidenceIds);
  const evidence = [];
  for (const candidate of sources) {
    const source = record(candidate);
    if (!source) continue;
    const sourceId = identifier(source.id, 160);
    if (requested.has(sourceId)) {
      evidence.push({
        abstract: boundedText(source.abstract, 16_384),
        id: sourceId,
        kind: "external_metadata",
        source
      });
    }
    if (!Array.isArray(source.fullTextEvidence)) continue;
    for (const item of source.fullTextEvidence) {
      const span = record(item);
      if (!span || !requested.has(span.id)) continue;
      const contentHash = boundedText(span.contentHash, 64);
      if (!/^[a-f0-9]{64}$/.test(contentHash) || source.localPdfContentHash !== contentHash ||
        typeof source.fullTextGrantId !== "string") fail("thin_reading_visualization_external_grant_invalid", 403);
      if (!Number.isSafeInteger(span.page) || span.page < 1 || span.page > 1_000_000) fail();
      evidence.push({
        contentHash,
        grantId: boundedText(source.fullTextGrantId, 200),
        id: identifier(span.id, 160),
        kind: "external_full_text",
        page: span.page,
        quote: boundedText(span.quote, 16_384),
        source,
        sourceId
      });
    }
  }
  return evidence;
}

async function loadPaperSources(pool, subjectId, paperIds) {
  if (paperIds.length === 0) return new Map();
  const result = await pool.query(`
    SELECT entry.document_id, entry.scope_id, entry.scope_type, reference.content_hash
      FROM library_entries entry
      JOIN storage_object_references reference USING(document_id)
      JOIN storage_objects object ON object.content_hash = reference.content_hash
     WHERE entry.document_id = ANY($1::text[])
       AND entry.entry_kind = 'pdf' AND entry.status = 'active'
       AND entry.availability = 'available' AND object.status = 'available'
       AND object.security_scan_hash = object.content_hash
       AND (entry.scope_type = 'user' AND entry.scope_id = $2 OR
            entry.scope_type = 'organization' AND EXISTS (
              SELECT 1 FROM organizations organization
              LEFT JOIN organization_members member
                ON member.organization_id = organization.organization_id
               AND member.member_subject = $2
             WHERE organization.organization_id = entry.scope_id
               AND organization.status = 'active'
               AND (organization.owner_subject = $2 OR member.status = 'active')
            ))
  `, [paperIds, subjectId]);
  return new Map(result.rows.map((row) => [row.document_id, {
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    sourceIdentityHash: row.content_hash
  }]));
}

async function loadMetadataSources(pool, subjectId, sourceIds) {
  if (sourceIds.length === 0) return new Map();
  const result = await pool.query(`
    SELECT cache.cache_key, item.value->'source' AS cached_source
      FROM external_retrieval_cache cache
      CROSS JOIN LATERAL jsonb_array_elements(cache.payload->'items') item(value)
     WHERE cache.subject_id = $1 AND cache.expires_at > now()
       AND item.value->'source'->>'id' = ANY($2::text[])
  `, [subjectId, sourceIds]);
  return new Map(result.rows.map((row) => [row.cached_source?.id, row]));
}

async function loadFullTextGrants(pool, subjectId, grantIds) {
  if (grantIds.length === 0) return new Map();
  const result = await pool.query(`
    SELECT grant_id, source_id, source_record_id, connector_source_id, connector_type, source_url
      FROM external_retrieval_pdf_grants
     WHERE subject_id = $1 AND grant_id = ANY($2::text[]) AND expires_at > now()
  `, [subjectId, grantIds]);
  return new Map(result.rows.map((row) => [row.grant_id, row]));
}

function sameExternalIdentity(stored, current) {
  return record(stored) && stored.id === current.id && stored.sourceId === current.sourceId &&
    stored.provider === current.provider && stored.sourceRecordUrl === current.sourceRecordUrl;
}

export async function resolveThinReadingVisualizationSource(input, dependencies) {
  const request = exactFields(input, new Set(["artifactId", "nodeId", "subjectId"]));
  const artifactId = identifier(request.artifactId, 120);
  const nodeId = identifier(request.nodeId, 160);
  const subjectId = boundedText(request.subjectId, 300, "identity_subject_invalid");
  if (!dependencies?.agentArtifactRepository || !dependencies?.pool) {
    throw new Error("thin_reading_visualization_source_dependencies_invalid");
  }
  const stored = await dependencies.agentArtifactRepository.get(subjectId, artifactId);
  const artifact = record(stored.artifact);
  const document = record(artifact?.thinReadingDocument);
  if (artifact?.artifactType !== "thin_reading" || document?.version !== "liteasy.thin-reading/v2" ||
    artifact.artifactId !== artifactId || document.artifactId !== artifactId || !Number.isSafeInteger(stored.revision) || stored.revision < 1) {
    fail();
  }
  const node = record(record(document.nodes)?.[nodeId]);
  const decision = record(node?.visualizationDecision);
  if (!node || node.id !== nodeId || decision?.status !== "accepted") fail();
  const intent = normalizeIntent(decision.intent, nodeId);
  const evidenceState = record(node.evidence);
  if (!evidenceState) fail();

  const paper = paperEvidence(evidenceState.paperEvidenceSpans, intent.evidenceIds);
  const external = externalEvidence(evidenceState.externalSources, intent.evidenceIds);
  const allIds = [...paper, ...external].map((item) => item.id);
  if (allIds.length !== intent.evidenceIds.length || new Set(allIds).size !== allIds.length ||
    intent.evidenceIds.some((id) => !allIds.includes(id))) fail();

  const paperIds = [...new Set(paper.map((item) => item.paperId))];
  const paperSources = await loadPaperSources(dependencies.pool, subjectId, paperIds);
  if (paperIds.some((id) => !/^[a-f0-9]{64}$/.test(paperSources.get(id)?.sourceIdentityHash ?? ""))) {
    fail("thin_reading_visualization_source_access_revoked", 403);
  }
  const metadataIds = [...new Set(external.filter((item) => item.kind === "external_metadata").map((item) => item.source.id))];
  const metadataSources = await loadMetadataSources(dependencies.pool, subjectId, metadataIds);
  if (metadataIds.some((id) => !sameExternalIdentity(metadataSources.get(id)?.cached_source, external.find((item) => item.source.id === id)?.source))) {
    fail("thin_reading_visualization_external_source_expired", 403);
  }
  const grantIds = [...new Set(external.filter((item) => item.kind === "external_full_text").map((item) => item.grantId))];
  const grants = await loadFullTextGrants(dependencies.pool, subjectId, grantIds);
  if (external.some((item) => item.kind === "external_full_text" && grants.get(item.grantId)?.source_id !== item.sourceId)) {
    fail("thin_reading_visualization_external_grant_invalid", 403);
  }

  const normalizedEvidence = [
    ...paper.map((item) => ({ ...item, sourceIdentityHash: paperSources.get(item.paperId).sourceIdentityHash })),
    ...external.map((item) => {
      if (item.kind === "external_metadata") {
        const cached = metadataSources.get(item.source.id);
        return {
          abstract: item.abstract,
          id: item.id,
          kind: item.kind,
          sourceId: item.source.id,
          sourceIdentityHash: digest({ cacheKey: cached.cache_key, source: cached.cached_source })
        };
      }
      const grant = grants.get(item.grantId);
      return {
        contentHash: item.contentHash,
        id: item.id,
        kind: item.kind,
        page: item.page,
        quote: item.quote,
        sourceId: item.sourceId,
        sourceIdentityHash: digest({ contentHash: item.contentHash, grant })
      };
    })
  ].sort((left, right) => intent.evidenceIds.indexOf(left.id) - intent.evidenceIds.indexOf(right.id));
  if (Buffer.byteLength(JSON.stringify(normalizedEvidence)) > maximumEvidenceBytes) {
    fail("thin_reading_visualization_evidence_too_large", 413);
  }

  const externalDocuments = external.map((item) => ({
    documentId: item.sourceId ?? item.source.id,
    sourceIdentityHash: normalizedEvidence.find((evidence) => evidence.id === item.id).sourceIdentityHash
  }));
  const uniqueDocuments = new Map([
    ...paperIds.map((documentId) => [documentId, { documentId, ...paperSources.get(documentId) }]),
    ...externalDocuments.map((document) => [document.documentId, document])
  ]);
  const documents = [...uniqueDocuments.values()];
  if (documents.length === 0) fail();
  const primaryDocumentId = paperIds.includes(document.paperIds?.[0]) ? document.paperIds[0] : documents[0].documentId;
  const projectedDocuments = documents.map((source) => ({ ...source, isPrimary: source.documentId === primaryDocumentId }));
  if (projectedDocuments.filter((source) => source.isPrimary).length !== 1) fail();

  const locale = boundedText(document.targetLanguage, 35);
  const intentHash = digest({
    artifactRevision: stored.revision,
    evidence: normalizedEvidence.map(({ id, sourceIdentityHash }) => ({ id, sourceIdentityHash })),
    intent,
    nodeId
  });
  return {
    artifactRevision: stored.revision,
    documents: projectedDocuments,
    evidence: normalizedEvidence,
    intent,
    intentHash,
    locale,
    nodeId
  };
}

export class ThinReadingVisualizationSourceResolver {
  constructor(dependencies) {
    this.dependencies = dependencies;
  }

  resolve(input) {
    return resolveThinReadingVisualizationSource(input, this.dependencies);
  }
}
