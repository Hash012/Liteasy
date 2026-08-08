import { createHash, randomUUID } from "node:crypto";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const cacheTtl = "24 hours";
const candidateTtl = "30 days";

function text(value, maximum, code = "recommendation_input_invalid") {
  if (typeof value !== "string") throw new LibraryRepositoryError(code);
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum) throw new LibraryRepositoryError(code);
  return normalized;
}

function optionalText(value, maximum, code) {
  return value === undefined || value === null || value === "" ? undefined : text(value, maximum, code);
}

function idempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new LibraryRepositoryError("idempotency_key_invalid");
  }
  return value;
}

function recommendation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryRepositoryError("recommendation_payload_invalid");
  }
  const sourceKind = value.sourceKind;
  const sourceUrl = optionalText(value.sourceUrl, 1000, "recommendation_payload_invalid");
  const fullTextUrl = optionalText(value.fullTextUrl, 2000, "recommendation_payload_invalid");
  if (!new Set(["cache", "live"]).has(sourceKind) ||
    (sourceKind === "live" && (!sourceUrl || !sourceUrl.startsWith("https://"))) ||
    (fullTextUrl && (!fullTextUrl.startsWith("https://") || value.openAccessAvailable !== true)) ||
    !new Set(["high", "medium", "low"]).has(value.relevanceBand) ||
    !Number.isFinite(value.relevanceScore) || value.relevanceScore < 0 || value.relevanceScore > 1) {
    throw new LibraryRepositoryError("recommendation_payload_invalid");
  }
  return {
    ...value,
    discoveredAt: text(value.discoveredAt, 80, "recommendation_payload_invalid"),
    id: text(value.id, 300, "recommendation_payload_invalid"),
    reason: text(value.reason, 4000, "recommendation_payload_invalid"),
    relatedDocumentTitle: text(value.relatedDocumentTitle, 500, "recommendation_payload_invalid"),
    source: text(value.source, 120, "recommendation_payload_invalid"),
    ...(fullTextUrl ? { fullTextUrl } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    title: text(value.title, 500, "recommendation_payload_invalid")
  };
}

function recommendations(values) {
  if (!Array.isArray(values) || values.length > 50) {
    throw new LibraryRepositoryError("recommendation_payload_invalid");
  }
  const normalized = values.map(recommendation);
  if (Buffer.byteLength(JSON.stringify(normalized)) > 512 * 1024) {
    throw new LibraryRepositoryError("recommendation_payload_too_large", 413);
  }
  return normalized;
}

function cacheScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !/^selection:[a-f0-9]{8}$/.test(value.selectionKey) ||
    !/^workspace:[a-f0-9]{8}$/.test(value.workspaceKey) ||
    !new Set(["relevance", "retrieved_at"]).has(value.sortMode) ||
    (value.personalizationVersion !== undefined &&
      (!Number.isSafeInteger(value.personalizationVersion) || value.personalizationVersion < 0))) {
    throw new LibraryRepositoryError("recommendation_cache_scope_invalid");
  }
  return {
    personalizationVersion: value.personalizationVersion ?? 0,
    selectionKey: value.selectionKey,
    sortMode: value.sortMode,
    workspaceKey: value.workspaceKey
  };
}

function scopeKey(scope) {
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

async function state(client, subject) {
  await client.query(`
    INSERT INTO personalization_states(subject_id) VALUES ($1)
    ON CONFLICT (subject_id) DO NOTHING
  `, [subject]);
  const result = await client.query(
    "SELECT enabled, version FROM personalization_states WHERE subject_id = $1",
    [subject]
  );
  return { enabled: result.rows[0].enabled, version: Number(result.rows[0].version) };
}

export class PostgresRecommendationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async context(subjectInput) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const current = await state(this.pool, subject);
    if (!current.enabled) return { enabled: false, feedback: [], suppressions: [], terms: [], version: current.version };
    const [terms, feedback, suppressions] = await Promise.all([
      this.pool.query(`
        SELECT term, weight FROM personalization_terms
         WHERE subject_id = $1 AND weight > 0
         ORDER BY weight DESC, evidence_count DESC, term LIMIT 8
      `, [subject]),
      this.pool.query(`
        SELECT recommendation_id, body FROM recommendation_feedback
         WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 500
      `, [subject]),
      this.pool.query(`
        SELECT recommendation_id FROM recommendation_suppressions WHERE subject_id = $1
      `, [subject])
    ]);
    return {
      enabled: true,
      feedback: feedback.rows.map((row) => ({ recommendationId: row.recommendation_id, ...row.body })),
      suppressions: suppressions.rows.map((row) => row.recommendation_id),
      terms: terms.rows.map((row) => ({ term: row.term, weight: Number(row.weight) })),
      version: current.version
    };
  }

  async saveCandidates(subjectInput, values, traceId) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const items = recommendations(values);
    return withPostgresTransaction(this.pool, async (client) => {
      for (const item of items) {
        await client.query(`
          INSERT INTO recommendation_candidates(candidate_id, subject_id, body, expires_at)
          VALUES ($1, $2, $3::jsonb, now() + interval '${candidateTtl}')
          ON CONFLICT (subject_id, candidate_id) DO UPDATE SET
            body = excluded.body, expires_at = excluded.expires_at, created_at = now()
        `, [item.id, subject, JSON.stringify(item)]);
      }
      await client.query(`
        INSERT INTO audit_events(
          audit_id, actor_id, actor_audience, action, resource_type,
          resource_id, scope_type, scope_id, trace_id, detail
        ) VALUES ($1, $2, 'liteasy-desktop', 'generate_recommendations',
          'recommendation', $2, 'user', $2, $3, $4::jsonb)
      `, [`audit_${randomUUID()}`, subject, traceId, JSON.stringify({ candidateCount: items.length })]);
      return items;
    });
  }

  async loadCandidate(subjectInput, candidateIdInput) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const candidateId = text(candidateIdInput, 300, "recommendation_candidate_invalid");
    const result = await this.pool.query(`
      SELECT body FROM recommendation_candidates
       WHERE subject_id = $1 AND candidate_id = $2 AND expires_at > now()
    `, [subject, candidateId]);
    if (!result.rows[0]) throw new LibraryRepositoryError("recommendation_candidate_not_found", 404);
    return recommendation(result.rows[0].body);
  }

  async getCache(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const scope = cacheScope(input);
    const current = await state(this.pool, subject);
    if (scope.personalizationVersion !== current.version) return { cacheHit: false, recommendations: [] };
    const result = await this.pool.query(`
      SELECT body, created_at, expires_at FROM recommendation_cache_entries
       WHERE subject_id = $1 AND cache_key = $2 AND personalization_version = $3
         AND expires_at > now()
    `, [subject, scopeKey(scope), current.version]);
    if (!result.rows[0]) return { cacheHit: false, recommendations: [] };
    return {
      cacheHit: true,
      cachedAt: result.rows[0].created_at.toISOString(),
      expiresAt: result.rows[0].expires_at.toISOString(),
      recommendations: recommendations(result.rows[0].body.recommendations ?? [])
    };
  }

  async putCache(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const scope = cacheScope(input);
    const items = recommendations(input.recommendations);
    const current = await state(this.pool, subject);
    if (scope.personalizationVersion !== current.version) {
      throw new LibraryRepositoryError("personalization_version_conflict", 409);
    }
    const result = await this.pool.query(`
      INSERT INTO recommendation_cache_entries(
        subject_id, cache_key, personalization_version, body, expires_at
      ) VALUES ($1, $2, $3, $4::jsonb, now() + interval '${cacheTtl}')
      ON CONFLICT (subject_id, cache_key) DO UPDATE SET
        personalization_version = excluded.personalization_version,
        body = excluded.body, expires_at = excluded.expires_at, created_at = now()
      RETURNING created_at, expires_at
    `, [subject, scopeKey(scope), current.version, JSON.stringify({ recommendations: items })]);
    await this.pool.query(`
      DELETE FROM recommendation_cache_entries WHERE subject_id = $1 AND cache_key IN (
        SELECT cache_key FROM recommendation_cache_entries WHERE subject_id = $1
        ORDER BY created_at DESC, cache_key OFFSET 100
      )
    `, [subject]);
    return {
      cachedAt: result.rows[0].created_at.toISOString(),
      expiresAt: result.rows[0].expires_at.toISOString(),
      ok: true
    };
  }

  async clearCache(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const scope = cacheScope(input);
    await this.pool.query(
      "DELETE FROM recommendation_cache_entries WHERE subject_id = $1 AND cache_key = $2",
      [subject, scopeKey(scope)]
    );
    return { cleared: true };
  }

  async recordFeedback(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const action = input.action;
    if (!new Set(["saved", "dismissed"]).has(action) || !input.candidate || typeof input.candidate !== "object") {
      throw new LibraryRepositoryError("recommendation_feedback_invalid");
    }
    const candidate = {
      canonicalId: optionalText(input.candidate.canonicalId, 300, "recommendation_feedback_invalid"),
      id: text(input.candidate.id, 300, "recommendation_feedback_invalid"),
      source: text(input.candidate.source, 120, "recommendation_feedback_invalid"),
      title: text(input.candidate.title, 500, "recommendation_feedback_invalid")
    };
    const key = idempotencyKey(input.idempotencyKey);
    const operation = "record_recommendation_feedback";
    const requestHash = createHash("sha256").update(JSON.stringify({ action, candidate, subject })).digest("hex");
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${subject}:${operation}:${key}`]);
      const prior = await client.query(`
        SELECT request_hash, response_body FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
      `, [subject, operation, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
        return prior.rows[0].response_body;
      }
      const feedbackId = `feedback_${createHash("sha256").update(`${subject}:${candidate.id}`).digest("hex").slice(0, 32)}`;
      const body = { action, canonicalId: candidate.canonicalId, source: candidate.source, title: candidate.title };
      await client.query(`
        INSERT INTO recommendation_feedback(feedback_id, subject_id, recommendation_id, body)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (feedback_id) DO UPDATE SET body = excluded.body, created_at = now()
      `, [feedbackId, subject, candidate.id, JSON.stringify(body)]);
      if (action === "dismissed") {
        await client.query(`
          INSERT INTO recommendation_suppressions(subject_id, recommendation_id)
          VALUES ($1, $2) ON CONFLICT DO NOTHING
        `, [subject, candidate.id]);
      } else {
        await client.query(`
          DELETE FROM recommendation_suppressions WHERE subject_id = $1 AND recommendation_id = $2
        `, [subject, candidate.id]);
      }
      const invalidated = await client.query(
        "DELETE FROM recommendation_cache_entries WHERE subject_id = $1",
        [subject]
      );
      const response = { feedback: { action, ...candidate }, invalidatedCacheEntries: invalidated.rowCount };
      await client.query(`
        INSERT INTO idempotency_records(
          actor_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at
        ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
      `, [subject, operation, key, requestHash, JSON.stringify(response)]);
      await client.query(`
        INSERT INTO audit_events(
          audit_id, actor_id, actor_audience, action, resource_type,
          resource_id, scope_type, scope_id, trace_id, detail
        ) VALUES ($1, $2, 'liteasy-desktop', $3, 'recommendation',
          $4, 'user', $2, $5, $6::jsonb)
      `, [`audit_${randomUUID()}`, subject, operation, candidate.id, input.traceId, JSON.stringify({ action })]);
      return response;
    });
  }
}
