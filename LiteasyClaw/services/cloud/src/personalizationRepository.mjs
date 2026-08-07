import { createHash, randomUUID } from "node:crypto";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const stages = new Set(["未设置", "本科生", "硕士研究生", "博士研究生", "教师/研究员", "产业研发"]);
const signalWeights = { paper_opened: 0.15, recommendation_saved: 1 };
const manifestKeys = new Set([
  "authors", "contentHash", "doi", "publicationYear", "syncDocumentId", "title"
]);

function text(value, maximum, code = "personalization_input_invalid") {
  if (typeof value !== "string") throw new LibraryRepositoryError(code);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum) throw new LibraryRepositoryError(code);
  return normalized;
}

function optionalText(value, maximum) {
  if (value === undefined || value === null || value === "") return null;
  return text(value, maximum);
}

function idempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new LibraryRepositoryError("idempotency_key_invalid");
  }
  return value;
}

function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LibraryRepositoryError("personalization_version_invalid");
  }
  return value;
}

function normalizeProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !stages.has(value.stage)) {
    throw new LibraryRepositoryError("academic_profile_invalid");
  }
  if (!Array.isArray(value.disciplines) || value.disciplines.length > 12) {
    throw new LibraryRepositoryError("academic_profile_invalid");
  }
  const disciplines = value.disciplines.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new LibraryRepositoryError("academic_profile_invalid");
    }
    return {
      categoryCode: text(item.categoryCode, 12, "academic_profile_invalid"),
      categoryName: text(item.categoryName, 80, "academic_profile_invalid"),
      code: text(item.code, 24, "academic_profile_invalid"),
      description: typeof item.description === "string" ? item.description.normalize("NFKC").trim().slice(0, 240) : "",
      name: text(item.name, 120, "academic_profile_invalid")
    };
  });
  if (new Set(disciplines.map((item) => item.code)).size !== disciplines.length) {
    throw new LibraryRepositoryError("academic_profile_invalid");
  }
  return { disciplines, stage: value.stage };
}

function extractTerms(value) {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const latin = normalized.match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chinese = chineseRuns.flatMap((run) =>
    Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  );
  return [...new Set([...latin, ...chinese])].slice(0, 16);
}

function normalizeSignal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryRepositoryError("personalization_signal_invalid");
  }
  if (value.kind === "recommendation_dismissed") {
    return {
      kind: value.kind,
      recommendationId: text(value.recommendationId, 300, "personalization_signal_invalid")
    };
  }
  if (!Object.hasOwn(signalWeights, value.kind)) {
    throw new LibraryRepositoryError("personalization_signal_invalid");
  }
  return {
    kind: value.kind,
    title: text(value.title, 500, "personalization_signal_invalid"),
    workId: optionalText(value.workId, 300)
  };
}

function normalizeManifest(documents) {
  if (!Array.isArray(documents) || documents.length > 5000) {
    throw new LibraryRepositoryError("local_manifest_invalid");
  }
  return documents.map((document) => {
    if (!document || typeof document !== "object" || Array.isArray(document) ||
      Object.keys(document).some((key) => !manifestKeys.has(key))) {
      throw new LibraryRepositoryError("local_manifest_forbidden_field");
    }
    const syncDocumentId = text(document.syncDocumentId, 180, "local_manifest_invalid");
    if (!/^[A-Za-z0-9._:-]+$/.test(syncDocumentId)) throw new LibraryRepositoryError("local_manifest_invalid");
    const contentHash = optionalText(document.contentHash, 64)?.toLocaleLowerCase("en-US") ?? null;
    if (contentHash && !/^[a-f0-9]{64}$/.test(contentHash)) throw new LibraryRepositoryError("local_manifest_invalid");
    const authors = Array.isArray(document.authors)
      ? document.authors.map((author) => text(author, 200, "local_manifest_invalid")).slice(0, 100)
      : [];
    const publicationYear = document.publicationYear === undefined || document.publicationYear === null
      ? null
      : document.publicationYear;
    if (publicationYear !== null && (!Number.isInteger(publicationYear) || publicationYear < 1000 || publicationYear > 9999)) {
      throw new LibraryRepositoryError("local_manifest_invalid");
    }
    return {
      authors,
      contentHash,
      doi: optionalText(document.doi, 300),
      publicationYear,
      syncDocumentId,
      title: text(document.title, 500, "local_manifest_invalid")
    };
  });
}

async function ensureState(client, subject) {
  await client.query(`
    INSERT INTO personalization_states(subject_id) VALUES ($1)
    ON CONFLICT (subject_id) DO NOTHING
  `, [subject]);
}

async function snapshot(client, subject) {
  const state = await client.query("SELECT * FROM personalization_states WHERE subject_id = $1", [subject]);
  const profile = await client.query("SELECT * FROM academic_profiles WHERE subject_id = $1", [subject]);
  const terms = await client.query(`
    SELECT term, weight, evidence_count, signal_source FROM personalization_terms
     WHERE subject_id = $1 AND weight > 0
     ORDER BY weight DESC, evidence_count DESC, updated_at DESC, term
     LIMIT 12
  `, [subject]);
  const stateRow = state.rows[0];
  const profileRow = profile.rows[0];
  const tags = terms.rows.map((row) => ({
    evidenceCount: Number(row.evidence_count),
    label: row.term,
    signalSource: row.signal_source ?? undefined,
    weight: Number(row.weight)
  }));
  const result = {
    enabled: stateRow?.enabled ?? true,
    personalizationVersion: Number(stateRow?.version ?? 0),
    profile: {
      disciplines: profileRow?.disciplines ?? [],
      profileVersion: Number(profileRow?.profile_version ?? 0),
      stage: profileRow?.stage ?? "未设置"
    },
    tags
  };
  if (stateRow?.enabled && tags.length > 0) {
    result.assistantSummary = `近期产品内关注：${tags.slice(0, 5).map((item) => item.label).join("、")}`;
  }
  return result;
}

export class PostgresPersonalizationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get(subject) {
    return snapshot(this.pool, text(subject, 300, "identity_subject_invalid"));
  }

  async purgeExpiredCaches(limit = 1000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new LibraryRepositoryError("maintenance_limit_invalid");
    }
    return withPostgresTransaction(this.pool, async (client) => {
      const candidates = await client.query(`
        WITH expired AS (
          SELECT candidate_id FROM recommendation_candidates
           WHERE expires_at <= now()
           ORDER BY expires_at, candidate_id
           LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        DELETE FROM recommendation_candidates candidate
         USING expired WHERE candidate.candidate_id = expired.candidate_id
      `, [limit]);
      const cacheEntries = await client.query(`
        WITH expired AS (
          SELECT subject_id, cache_key FROM recommendation_cache_entries
           WHERE expires_at <= now()
           ORDER BY expires_at, subject_id, cache_key
           LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        DELETE FROM recommendation_cache_entries cache
         USING expired
         WHERE cache.subject_id = expired.subject_id AND cache.cache_key = expired.cache_key
      `, [limit]);
      const idempotencyRecords = await client.query(`
        WITH expired AS (
          SELECT actor_id, operation, idempotency_key FROM idempotency_records
           WHERE expires_at <= now()
           ORDER BY expires_at, actor_id, operation, idempotency_key
           LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        DELETE FROM idempotency_records record
         USING expired
         WHERE record.actor_id = expired.actor_id
           AND record.operation = expired.operation
           AND record.idempotency_key = expired.idempotency_key
      `, [limit]);
      return {
        recommendationCacheEntries: cacheEntries.rowCount,
        recommendationCandidates: candidates.rowCount,
        idempotencyRecords: idempotencyRecords.rowCount
      };
    });
  }

  async saveProfile(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const profile = normalizeProfile(input.profile);
    return this.#mutation(subject, input, "save_academic_profile", true, async (client) => {
      await client.query(`
        INSERT INTO academic_profiles(subject_id, stage, disciplines)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (subject_id) DO UPDATE SET
          stage = excluded.stage, disciplines = excluded.disciplines,
          profile_version = academic_profiles.profile_version + 1, updated_at = now()
      `, [subject, profile.stage, JSON.stringify(profile.disciplines)]);
    });
  }

  async setEnabled(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    if (typeof input.enabled !== "boolean") throw new LibraryRepositoryError("personalization_setting_invalid");
    return this.#mutation(subject, input, "update_personalization_setting", true, async (client) => {
      await client.query("UPDATE personalization_states SET enabled = $2 WHERE subject_id = $1", [subject, input.enabled]);
    });
  }

  async recordSignal(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const signal = normalizeSignal(input.signal);
    return this.#mutation(subject, input, "record_personalization_signal", false, async (client, state) => {
      if (!state.enabled) throw new LibraryRepositoryError("personalization_disabled", 409);
      await client.query(`
        INSERT INTO personalization_signals(signal_id, subject_id, kind, payload)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [`signal_${randomUUID()}`, subject, signal.kind, JSON.stringify(signal)]);
      if (signal.kind === "recommendation_dismissed") {
        await client.query(`
          INSERT INTO recommendation_suppressions(subject_id, recommendation_id)
          VALUES ($1, $2) ON CONFLICT DO NOTHING
        `, [subject, signal.recommendationId]);
      } else {
        for (const term of extractTerms(signal.title)) {
          await client.query(`
            INSERT INTO personalization_terms(subject_id, term, weight, signal_source)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (subject_id, term) DO UPDATE SET
              weight = LEAST(6, GREATEST(-4, personalization_terms.weight + excluded.weight)),
              evidence_count = personalization_terms.evidence_count + 1,
              signal_source = excluded.signal_source, updated_at = now()
          `, [subject, term, signalWeights[signal.kind], signal.kind]);
        }
      }
      await client.query("DELETE FROM recommendation_cache_entries WHERE subject_id = $1", [subject]);
    });
  }

  async syncLocalManifest(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    const documents = normalizeManifest(input.documents);
    const syncId = randomUUID();
    const syncedAt = new Date().toISOString();
    return this.#mutation(subject, input, "sync_local_library_manifest", false, async (client, state) => {
      if (!state.enabled) throw new LibraryRepositoryError("personalization_disabled", 409);
      for (const document of documents) {
        await client.query(`
          INSERT INTO local_library_manifest_entries(
            subject_id, sync_document_id, content_hash, title, authors, doi, publication_year
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
          ON CONFLICT (subject_id, sync_document_id) DO UPDATE SET
            content_hash = excluded.content_hash, title = excluded.title,
            authors = excluded.authors, doi = excluded.doi,
            publication_year = excluded.publication_year, updated_at = now()
        `, [
          subject, document.syncDocumentId, document.contentHash, document.title,
          JSON.stringify(document.authors), document.doi, document.publicationYear
        ]);
      }
      await client.query(`
        DELETE FROM local_library_manifest_entries
         WHERE subject_id = $1 AND NOT (sync_document_id = ANY($2::text[]))
      `, [subject, documents.map((item) => item.syncDocumentId)]);
    }, (state) => ({
      acceptedCount: documents.length,
      disabled: false,
      personalizationVersion: state.personalizationVersion,
      rejectedCount: 0,
      syncId,
      syncedAt
    }));
  }

  async clear(subjectInput, input) {
    const subject = text(subjectInput, 300, "identity_subject_invalid");
    let deletion;
    return this.#mutation(subject, input, "clear_personalization_data", true, async (client) => {
      await client.query("UPDATE personalization_states SET enabled = false WHERE subject_id = $1", [subject]);
      const tables = [
        "academic_profiles", "personalization_terms", "personalization_signals",
        "recommendation_feedback", "recommendation_suppressions", "recommendation_candidates",
        "recommendation_cache_entries", "local_library_manifest_entries"
      ];
      deletion = {};
      for (const table of tables) {
        const removed = await client.query(`DELETE FROM ${table} WHERE subject_id = $1`, [subject]);
        deletion[table] = removed.rowCount;
      }
    }, (state) => ({ ...state, cleared: true, deletion }));
  }

  async #mutation(subject, input, operation, requireExpectedVersion, mutate, decorate = (value) => value) {
    const key = idempotencyKey(input.idempotencyKey);
    const expected = requireExpectedVersion ? expectedVersion(input.expectedVersion) : undefined;
    const { actorId: _actor, traceId: _trace, ...requestBody } = input;
    const requestHash = createHash("sha256").update(JSON.stringify({ operation, requestBody, subject })).digest("hex");
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${subject}:${operation}:${key}`
      ]);
      const prior = await client.query(`
        SELECT request_hash, response_body FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
      `, [subject, operation, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
        return prior.rows[0].response_body;
      }
      await ensureState(client, subject);
      const locked = await client.query(
        "SELECT * FROM personalization_states WHERE subject_id = $1 FOR UPDATE",
        [subject]
      );
      const state = locked.rows[0];
      if (requireExpectedVersion && Number(state.version) !== expected) {
        throw new LibraryRepositoryError("personalization_version_conflict", 409);
      }
      await mutate(client, state);
      await client.query(`
        UPDATE personalization_states SET version = version + 1, updated_at = now()
        WHERE subject_id = $1
      `, [subject]);
      const response = decorate(await snapshot(client, subject));
      await client.query(`
        INSERT INTO idempotency_records(
          actor_id, operation, idempotency_key, request_hash, response_status,
          response_body, expires_at
        ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
      `, [subject, operation, key, requestHash, JSON.stringify(response)]);
      await client.query(`
        INSERT INTO audit_events(
          audit_id, actor_id, actor_audience, action, resource_type,
          resource_id, scope_type, scope_id, trace_id, detail
        ) VALUES ($1, $2, 'liteasy-desktop', $3, 'personalization', $2,
          'user', $2, $4, '{}'::jsonb)
      `, [`audit_${randomUUID()}`, subject, operation, input.traceId]);
      return response;
    });
  }
}
