import { createHash } from "node:crypto";
import { withPostgresTransaction } from "./postgres.mjs";

const activeStates = new Set(["cancel_requested", "queued", "running"]);
const terminalStates = new Set(["cancelled", "failed", "omitted", "succeeded"]);
const terminalMutationStates = new Set(["cancelled", "failed", "omitted"]);

export class VisualizationGenerationRepositoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function boundedText(value, maximum, code, pattern) {
  if (typeof value !== "string") throw new VisualizationGenerationRepositoryError(code);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum || (pattern && !pattern.test(normalized))) {
    throw new VisualizationGenerationRepositoryError(code);
  }
  return normalized;
}

function identifier(value, maximum, code) {
  return boundedText(value, maximum, code, /^[A-Za-z0-9._:-]+$/);
}

function subjectId(value) {
  return boundedText(value, 300, "identity_subject_invalid");
}

function hashValue(value, code) {
  return boundedText(value, 64, code, /^[a-f0-9]{64}$/);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeInteger(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new VisualizationGenerationRepositoryError(code);
  }
  return value;
}

function resultArtifactIds(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > 2 || (!allowEmpty && value.length === 0)) {
    throw new VisualizationGenerationRepositoryError("visualization_result_artifacts_invalid");
  }
  const ids = value.map((item) => identifier(item, 160, "visualization_result_artifacts_invalid"));
  if (new Set(ids).size !== ids.length) {
    throw new VisualizationGenerationRepositoryError("visualization_result_artifacts_invalid");
  }
  return ids;
}

function requestInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new VisualizationGenerationRepositoryError("visualization_request_invalid");
  }
  return {
    artifactId: identifier(input.artifactId, 160, "visualization_artifact_id_invalid"),
    artifactRevision: safeInteger(input.artifactRevision, 1, Number.MAX_SAFE_INTEGER, "visualization_artifact_revision_invalid"),
    intentHash: hashValue(input.intentHash, "visualization_intent_hash_invalid"),
    nodeId: identifier(input.nodeId, 160, "visualization_node_id_invalid"),
    requestId: identifier(input.requestId, 200, "visualization_request_id_invalid"),
    requestedArtifactCount: safeInteger(input.requestedArtifactCount, 1, 2, "visualization_requested_count_invalid"),
    traceId: identifier(input.traceId, 160, "trace_id_invalid")
  };
}

function publicProjection(row) {
  return {
    resultArtifactIds: row.state === "succeeded" && Array.isArray(row.result_artifact_ids)
      ? row.result_artifact_ids
      : [],
    reasonCode: row.terminal_reason ?? undefined,
    requestId: row.request_id,
    retryAfterMs: activeStates.has(row.state) ? 500 : undefined,
    status: row.state
  };
}

function claimProjection(row) {
  return {
    artifactId: row.artifact_id,
    artifactRevision: Number(row.artifact_revision),
    attempts: Number(row.attempts),
    intentHash: row.intent_hash,
    leaseExpiresAt: row.lease_expires_at?.toISOString?.() ?? null,
    leaseOwner: row.lease_owner,
    nodeId: row.node_id,
    requestId: row.request_id,
    requestedArtifactCount: Number(row.requested_artifact_count),
    state: row.state,
    subjectId: row.subject_id,
    traceId: row.trace_id
  };
}

function requireRow(row) {
  if (!row) throw new VisualizationGenerationRepositoryError("visualization_request_not_found", 404);
  return row;
}

function sameIds(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

export class PostgresVisualizationGenerationRepository {
  constructor(pool, options = {}) {
    if (!pool) throw new Error("visualization_generation_repository_pool_required");
    this.pool = pool;
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 30_000;
    this.recoveryBatchSize = options.recoveryBatchSize ?? 50;
  }

  async create(subjectInput, input) {
    const subject = subjectId(subjectInput);
    const request = requestInput(input);
    const requestHash = digest({
      artifactId: request.artifactId,
      artifactRevision: request.artifactRevision,
      intentHash: request.intentHash,
      nodeId: request.nodeId,
      requestId: request.requestId,
      requestedArtifactCount: request.requestedArtifactCount,
      subjectId: subject
    });
    const currentTime = this.now();
    return withPostgresTransaction(this.pool, async (client) => {
      const inserted = await client.query(`
        INSERT INTO visualization_generation_requests(
          subject_id, request_id, artifact_id, artifact_revision, node_id,
          request_hash, intent_hash, requested_artifact_count, trace_id,
          state, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$10)
        ON CONFLICT (subject_id, request_id) DO NOTHING
        RETURNING *
      `, [
        subject, request.requestId, request.artifactId, request.artifactRevision,
        request.nodeId, requestHash, request.intentHash,
        request.requestedArtifactCount, request.traceId, currentTime
      ]);
      if (inserted.rows[0]) return publicProjection(inserted.rows[0]);
      const existing = requireRow((await client.query(`
        SELECT * FROM visualization_generation_requests
         WHERE subject_id = $1 AND request_id = $2
         FOR UPDATE
      `, [subject, request.requestId])).rows[0]);
      if (existing.request_hash !== requestHash) {
        throw new VisualizationGenerationRepositoryError("visualization_request_id_reused", 409);
      }
      return publicProjection(existing);
    }, { isolation: "READ COMMITTED" });
  }

  async get(subjectInput, requestInputValue) {
    const subject = subjectId(subjectInput);
    const request = identifier(requestInputValue, 200, "visualization_request_id_invalid");
    const result = await this.pool.query(`
      SELECT * FROM visualization_generation_requests
       WHERE subject_id = $1 AND request_id = $2
    `, [subject, request]);
    return publicProjection(requireRow(result.rows[0]));
  }

  async claimNext(workerInput) {
    const worker = identifier(workerInput, 160, "visualization_worker_id_invalid");
    const currentTime = this.now();
    const leaseExpiresAt = new Date(currentTime.getTime() + this.leaseMs);
    return withPostgresTransaction(this.pool, async (client) => {
      const candidate = (await client.query(`
        SELECT * FROM visualization_generation_requests
         WHERE state = 'queued' AND attempts < 3
         ORDER BY created_at, subject_id, request_id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      `)).rows[0];
      if (!candidate) return null;
      const claimed = requireRow((await client.query(`
        UPDATE visualization_generation_requests
           SET state = 'running', lease_owner = $3, lease_expires_at = $4,
               attempts = attempts + 1, updated_at = $5
         WHERE subject_id = $1 AND request_id = $2 AND state = 'queued'
         RETURNING *
      `, [candidate.subject_id, candidate.request_id, worker, leaseExpiresAt, currentTime])).rows[0]);
      return claimProjection(claimed);
    }, { isolation: "READ COMMITTED" });
  }

  async requestCancel(subjectInput, requestInputValue, idempotencyInput) {
    const subject = subjectId(subjectInput);
    const request = identifier(requestInputValue, 200, "visualization_request_id_invalid");
    const idempotencyKey = identifier(idempotencyInput, 200, "idempotency_key_invalid");
    if (idempotencyKey.length < 8) throw new VisualizationGenerationRepositoryError("idempotency_key_invalid");
    const cancellationHash = digest({ requestId: request, subjectId: subject });
    const currentTime = this.now();
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `visualization-cancel:${subject}:${idempotencyKey}`
      ]);
      const row = requireRow((await client.query(`
        SELECT * FROM visualization_generation_requests
         WHERE subject_id = $1 AND request_id = $2
         FOR UPDATE
      `, [subject, request])).rows[0]);
      if (row.cancellation_idempotency_key != null) {
        if (row.cancellation_idempotency_key !== idempotencyKey || row.cancellation_hash !== cancellationHash) {
          throw new VisualizationGenerationRepositoryError("idempotency_key_reused", 409);
        }
        return publicProjection(row);
      }
      if (terminalStates.has(row.state)) {
        throw new VisualizationGenerationRepositoryError("visualization_request_terminal", 409);
      }
      const prior = (await client.query(`
        SELECT request_id, cancellation_hash
          FROM visualization_generation_requests
         WHERE subject_id = $1 AND cancellation_idempotency_key = $2
         FOR UPDATE
      `, [subject, idempotencyKey])).rows[0];
      if (prior && (prior.request_id !== request || prior.cancellation_hash !== cancellationHash)) {
        throw new VisualizationGenerationRepositoryError("idempotency_key_reused", 409);
      }
      const state = row.state === "queued" ? "cancelled" : "cancel_requested";
      const updated = requireRow((await client.query(`
        UPDATE visualization_generation_requests
           SET state = $5, cancellation_idempotency_key = $3,
               cancellation_hash = $4, cancellation_requested_at = $6,
               terminal_reason = CASE WHEN $5 = 'cancelled' THEN 'cancelled' ELSE NULL END,
               lease_owner = CASE WHEN $5 = 'cancelled' THEN NULL ELSE lease_owner END,
               lease_expires_at = CASE WHEN $5 = 'cancelled' THEN NULL ELSE lease_expires_at END,
               updated_at = $6
         WHERE subject_id = $1 AND request_id = $2
         RETURNING *
      `, [subject, request, idempotencyKey, cancellationHash, state, currentTime])).rows[0]);
      return publicProjection(updated);
    }, { isolation: "READ COMMITTED" });
  }

  async markSucceeded(subjectInput, requestInputValue, artifactsInput, reasonInput) {
    const subject = subjectId(subjectInput);
    const request = identifier(requestInputValue, 200, "visualization_request_id_invalid");
    const artifacts = resultArtifactIds(artifactsInput);
    const reason = reasonInput == null ? null : identifier(reasonInput, 120, "visualization_terminal_reason_invalid");
    const currentTime = this.now();
    return withPostgresTransaction(this.pool, async (client) => {
      const row = requireRow((await client.query(`
        SELECT * FROM visualization_generation_requests
         WHERE subject_id = $1 AND request_id = $2
         FOR UPDATE
      `, [subject, request])).rows[0]);
      if (new Set(["cancel_requested", "cancelled"]).has(row.state)) {
        throw new VisualizationGenerationRepositoryError("visualization_request_cancelled", 409);
      }
      if (row.state === "succeeded" && sameIds(row.result_artifact_ids, artifacts) && row.terminal_reason === reason) {
        return publicProjection(row);
      }
      if (terminalStates.has(row.state)) {
        throw new VisualizationGenerationRepositoryError("visualization_request_terminal", 409);
      }
      if (row.state !== "running" || artifacts.length > Number(row.requested_artifact_count)) {
        throw new VisualizationGenerationRepositoryError("visualization_request_transition_invalid", 409);
      }
      const updated = requireRow((await client.query(`
        UPDATE visualization_generation_requests
           SET state = 'succeeded', result_artifact_ids = $3::jsonb,
               terminal_reason = $4, lease_owner = NULL, lease_expires_at = NULL,
               updated_at = $5
         WHERE subject_id = $1 AND request_id = $2
         RETURNING *
      `, [subject, request, JSON.stringify(artifacts), reason, currentTime])).rows[0]);
      return publicProjection(updated);
    }, { isolation: "READ COMMITTED" });
  }

  async markTerminal(subjectInput, requestInputValue, stateInput, reasonInput) {
    const subject = subjectId(subjectInput);
    const request = identifier(requestInputValue, 200, "visualization_request_id_invalid");
    const state = boundedText(stateInput, 32, "visualization_request_state_invalid");
    if (!terminalMutationStates.has(state)) {
      throw new VisualizationGenerationRepositoryError("visualization_request_state_invalid");
    }
    const reason = identifier(reasonInput, 120, "visualization_terminal_reason_invalid");
    const currentTime = this.now();
    return withPostgresTransaction(this.pool, async (client) => {
      const row = requireRow((await client.query(`
        SELECT * FROM visualization_generation_requests
         WHERE subject_id = $1 AND request_id = $2
         FOR UPDATE
      `, [subject, request])).rows[0]);
      if (row.state === state && row.terminal_reason === reason) return publicProjection(row);
      if (terminalStates.has(row.state)) {
        throw new VisualizationGenerationRepositoryError("visualization_request_terminal", 409);
      }
      const allowed = state === "cancelled"
        ? new Set(["cancel_requested", "queued"])
        : new Set(["queued", "running"]);
      if (!allowed.has(row.state)) {
        throw new VisualizationGenerationRepositoryError("visualization_request_transition_invalid", 409);
      }
      const updated = requireRow((await client.query(`
        UPDATE visualization_generation_requests
           SET state = $3, terminal_reason = $4, result_artifact_ids = '[]'::jsonb,
               lease_owner = NULL, lease_expires_at = NULL, updated_at = $5
         WHERE subject_id = $1 AND request_id = $2
         RETURNING *
      `, [subject, request, state, reason, currentTime])).rows[0]);
      return publicProjection(updated);
    }, { isolation: "READ COMMITTED" });
  }

  async requeueExpired() {
    const currentTime = this.now();
    return withPostgresTransaction(this.pool, async (client) => {
      const expired = await client.query(`
        SELECT request.*,
               EXISTS (
                 SELECT 1
                   FROM visualization_quota_reservations reservation
                   JOIN visualization_provider_invocations invocation
                     ON invocation.reservation_id = reservation.reservation_id
                  WHERE reservation.subject_id = request.subject_id
                    AND left(reservation.idempotency_key, length(request.request_id) + 10) = request.request_id || ':artifact:'
                    AND invocation.state <> 'started'
               ) AS has_terminal_invocation
          FROM visualization_generation_requests request
         WHERE request.state IN ('running','cancel_requested')
           AND request.lease_expires_at <= $1
         ORDER BY request.lease_expires_at, request.subject_id, request.request_id
         LIMIT $2
         FOR UPDATE OF request SKIP LOCKED
      `, [currentTime, this.recoveryBatchSize]);
      const cancelledRequestIds = [];
      const failedRequestIds = [];
      const requeuedRequestIds = [];
      for (const row of expired.rows) {
        let state = "queued";
        let reason = null;
        if (row.state === "cancel_requested") {
          state = "cancelled";
          reason = "cancelled";
        } else if (row.has_terminal_invocation) {
          state = "failed";
          reason = "provider_result_recovery_required";
        } else if (Number(row.attempts) >= 3) {
          state = "failed";
          reason = "internal_failure";
        }
        const updated = requireRow((await client.query(`
          UPDATE visualization_generation_requests
             SET state = $3, terminal_reason = $4,
                 lease_owner = NULL, lease_expires_at = NULL, updated_at = $5
           WHERE subject_id = $1 AND request_id = $2
           RETURNING *
        `, [row.subject_id, row.request_id, state, reason, currentTime])).rows[0]);
        if (updated.state === "queued") requeuedRequestIds.push(updated.request_id);
        else if (updated.state === "cancelled") cancelledRequestIds.push(updated.request_id);
        else failedRequestIds.push(updated.request_id);
      }
      return { cancelledRequestIds, failedRequestIds, requeuedRequestIds };
    }, { isolation: "READ COMMITTED" });
  }
}
