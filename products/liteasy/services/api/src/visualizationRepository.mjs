import { createHash, randomUUID } from "node:crypto";
import { withPostgresTransaction } from "./postgres.mjs";

function subjectId(input) {
  const value = typeof input === "string" ? input : input?.subjectId;
  if (!value || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error("visualization_subject_invalid");
  return value;
}

function required(input, name) {
  if (typeof input?.[name] !== "string" || input[name].trim() === "") throw new Error(`visualization_${name}_invalid`);
  return input[name].trim();
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rowPreference(row) {
  return row ? { enabled: row.enabled, revision: Number(row.revision ?? 1), updatedAt: row.updated_at?.toISOString?.() ?? null } : null;
}

function rowEntitlement(row) {
  return row ? {
    allowed: row.allowed,
    explicitRequestsAllowed: row.explicit_requests_allowed,
    allowedModalities: row.allowed_modalities ?? [],
    revision: Number(row.revision ?? 1)
  } : { allowed: false, explicitRequestsAllowed: false, allowedModalities: [], revision: 0 };
}

function reservationView(row) {
  return row ? {
    reservationId: row.reservation_id,
    subjectId: row.subject_id,
    idempotencyKey: row.idempotency_key,
    modality: row.modality,
    routeId: row.route_id,
    reservedUnits: Number(row.reserved_units),
    settledUnits: row.settled_units == null ? null : Number(row.settled_units),
    state: row.state,
    expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at ?? null
  } : null;
}

export class PostgresVisualizationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getEntitlement(subject) {
    const id = subjectId(subject);
    const result = await this.pool.query("SELECT * FROM visualization_entitlements WHERE subject_id = $1", [id]);
    return rowEntitlement(result.rows[0]);
  }

  async capability(subject) {
    const id = subjectId(subject);
    const result = await this.pool.query(`
      SELECT e.*, p.enabled AS preference_enabled, p.revision AS preference_revision,
             q.daily_units, q.monthly_units, q.max_concurrency, q.timezone, q.revision AS policy_revision,
             COALESCE((SELECT SUM(GREATEST(units_delta, 0)) FROM visualization_usage_ledger u
                       WHERE u.subject_id = e.subject_id AND u.created_at >= date_trunc('day', now())), 0) AS daily_used,
             COALESCE((SELECT SUM(GREATEST(units_delta, 0)) FROM visualization_usage_ledger u
                       WHERE u.subject_id = e.subject_id AND u.created_at >= date_trunc('month', now())), 0) AS monthly_used,
             (SELECT COUNT(*) FROM visualization_quota_reservations r
               WHERE r.subject_id = e.subject_id AND r.state = 'reserved' AND r.expires_at > now()) AS active_count
        FROM visualization_entitlements e
        LEFT JOIN visualization_user_preferences p ON p.subject_id = e.subject_id
        LEFT JOIN visualization_quota_policies q ON q.subject_id = e.subject_id
       WHERE e.subject_id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row) return { allowed: false, enabled: false, serviceAvailable: false, availableModalities: [], quota: { available: false } };
    const daily = Number(row.daily_units ?? 0);
    const monthly = Number(row.monthly_units ?? 0);
    return {
      allowed: Boolean(row.allowed),
      enabled: Boolean(row.allowed && row.preference_enabled !== false),
      serviceAvailable: true,
      availableModalities: row.allowed_modalities ?? [],
      preference: rowPreference({ enabled: row.preference_enabled ?? true, revision: row.preference_revision ?? 1 }),
      quota: {
        available: true,
        dailyUnits: daily,
        monthlyUnits: monthly,
        usedUnits: Number(row.daily_used ?? 0),
        dailyUsedUnits: Number(row.daily_used ?? 0),
        monthlyUsedUnits: Number(row.monthly_used ?? 0),
        concurrency: { active: Number(row.active_count ?? 0), limit: Number(row.max_concurrency ?? 0) },
        timezone: row.timezone ?? "UTC"
      }
    };
  }

  async setPreference(subject, input) {
    const id = subjectId(subject);
    if (typeof input?.enabled !== "boolean") throw new Error("visualization_preference_invalid");
    required(input, "idempotencyKey");
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        INSERT INTO visualization_user_preferences(subject_id, enabled, revision)
        VALUES ($1, $2, 1)
        ON CONFLICT(subject_id) DO UPDATE SET enabled = excluded.enabled,
          revision = visualization_user_preferences.revision + 1, updated_at = now()
        RETURNING *
      `, [id, input.enabled]);
      return { preference: rowPreference(result.rows[0]) };
    });
  }

  async setEntitlement(subject, input) {
    const id = subjectId(subject);
    if (typeof input?.allowed !== "boolean") throw new Error("visualization_entitlement_invalid");
    const modalities = Array.isArray(input.allowedModalities) ? input.allowedModalities : [];
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        INSERT INTO visualization_entitlements(subject_id, allowed, explicit_requests_allowed, allowed_modalities, revision, granted_by, reason)
        VALUES ($1, $2, $3, $4::jsonb, 1, $5, $6)
        ON CONFLICT(subject_id) DO UPDATE SET allowed = excluded.allowed,
          explicit_requests_allowed = excluded.explicit_requests_allowed, allowed_modalities = excluded.allowed_modalities,
          revision = visualization_entitlements.revision + 1, granted_by = excluded.granted_by, reason = excluded.reason, updated_at = now()
        RETURNING *
      `, [id, input.allowed, Boolean(input.explicitRequestsAllowed), JSON.stringify(modalities), input.grantedBy ?? null, input.reason ?? null]);
      return { entitlement: rowEntitlement(result.rows[0]) };
    });
  }

  async setQuotaPolicy(subject, input) {
    const id = subjectId(subject);
    if (!Number.isInteger(input?.dailyUnits) || input.dailyUnits < 0 || !Number.isInteger(input?.monthlyUnits) || input.monthlyUnits < 0 || !Number.isInteger(input?.maxConcurrency) || input.maxConcurrency <= 0) throw new Error("quota_policy_invalid");
    if (!input.timezone) throw new Error("quota_timezone_invalid");
    try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(); } catch { throw new Error("quota_timezone_invalid"); }
    required(input, "reason");
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        INSERT INTO visualization_quota_policies(subject_id, daily_units, monthly_units, max_concurrency, timezone, revision, updated_by, reason)
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
        ON CONFLICT(subject_id) DO UPDATE SET daily_units = excluded.daily_units, monthly_units = excluded.monthly_units,
          max_concurrency = excluded.max_concurrency, timezone = excluded.timezone, revision = visualization_quota_policies.revision + 1,
          updated_by = excluded.updated_by, reason = excluded.reason, updated_at = now()
        RETURNING *
      `, [id, input.dailyUnits, input.monthlyUnits, input.maxConcurrency, input.timezone, input.updatedBy ?? "system", input.reason]);
      return { policy: result.rows[0] };
    });
  }

  async reserve(subject, input) {
    const id = subjectId(subject);
    required(input, "idempotencyKey");
    required(input, "modality");
    required(input, "routeId");
    if (!Number.isInteger(input.units) || input.units <= 0) throw new Error("visualization_units_invalid");
    const hash = requestHash({ modality: input.modality, routeId: input.routeId, units: input.units });
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`visualization-reserve:${id}`]);
      const prior = await client.query("SELECT * FROM idempotency_records WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3", [id, "visualization-reserve", input.idempotencyKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new Error("idempotency_key_reused");
        return { replayed: true, reservation: prior.rows[0].response_body };
      }
      const entitlement = (await client.query("SELECT * FROM visualization_entitlements WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      const preference = (await client.query("SELECT * FROM visualization_user_preferences WHERE subject_id = $1", [id])).rows[0];
      const policy = (await client.query("SELECT * FROM visualization_quota_policies WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      if (!entitlement?.allowed || preference?.enabled === false) throw new Error("visualization_not_allowed");
      if (Array.isArray(entitlement.allowed_modalities) && entitlement.allowed_modalities.length > 0 && !entitlement.allowed_modalities.includes(input.modality)) throw new Error("visualization_modality_not_allowed");
      if (!policy) throw new Error("visualization_quota_unconfigured");
      const usage = await client.query(`
        SELECT
          COALESCE(SUM(GREATEST(units_delta, 0)) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS daily_used,
          COALESCE(SUM(GREATEST(units_delta, 0)) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS monthly_used
          FROM visualization_usage_ledger WHERE subject_id = $1
      `, [id]);
      const active = await client.query("SELECT COUNT(*) AS active_count FROM visualization_quota_reservations WHERE subject_id = $1 AND state = 'reserved' AND expires_at > now()", [id]);
      if (Number(usage.rows[0]?.daily_used ?? usage.rows[0]?.used_units ?? 0) + input.units > Number(policy.daily_units)
        || Number(usage.rows[0]?.monthly_used ?? 0) + input.units > Number(policy.monthly_units)
        || Number(active.rows[0]?.active_count ?? 0) >= Number(policy.max_concurrency)) throw new Error("visualization_quota_exceeded");
      const route = (await client.query("SELECT * FROM visualization_provider_configs WHERE route_id = $1 FOR UPDATE", [input.routeId])).rows[0];
      if (!route?.enabled || route.circuit_state === "open") throw new Error("visualization_route_unavailable");
      const reservationId = input.reservationId ?? `vizres_${randomUUID()}`;
      const expiresAt = new Date(Date.now() + (input.ttlMs ?? 120000));
      const result = await client.query(`INSERT INTO visualization_quota_reservations(reservation_id, subject_id, idempotency_key, modality, route_id, route_revision, policy_revision, reserved_units, state, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9) RETURNING *`, [reservationId, id, input.idempotencyKey, input.modality, input.routeId, Number(route.revision ?? 1), Number(policy.revision ?? 1), input.units, expiresAt]);
      const reservation = result.rows[0];
      await client.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, policy_revision, trace_id) VALUES ($1,$2,$3,$4,'reserved',$5,$6,$7)", [`vusage_${randomUUID()}`, id, reservationId, input.idempotencyKey, input.units, Number(policy.revision ?? 1), input.traceId ?? `trace_${randomUUID()}`]);
      await client.query("INSERT INTO idempotency_records(actor_id,operation,idempotency_key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,$4,201,$5::jsonb,now()+interval '1 day')", [id, "visualization-reserve", input.idempotencyKey, hash, JSON.stringify(reservation)]);
      return { replayed: false, reservation: reservationView(reservation) };
    });
  }

  async settle(subject, input) { return this.#transition(subject, input, "settled"); }
  async rollback(subject, input) { return this.#transition(subject, input, "rolled_back"); }

  async #transition(subject, input, state) {
    const id = subjectId(subject);
    required(input, "reservationId");
    return withPostgresTransaction(this.pool, async (client) => {
      const row = (await client.query("SELECT * FROM visualization_quota_reservations WHERE reservation_id = $1 AND subject_id = $2 FOR UPDATE", [input.reservationId, id])).rows[0];
      if (!row) throw new Error("visualization_reservation_not_found");
      if (row.state !== "reserved") return { reservation: reservationView(row), replayed: true };
      const settled = state === "settled" ? Number(input.settledUnits ?? row.reserved_units) : 0;
      const updated = (await client.query("UPDATE visualization_quota_reservations SET state = $1, settled_units = $2, updated_at = now() WHERE reservation_id = $3 RETURNING *", [state, settled, input.reservationId])).rows[0];
      await client.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [`vusage_${randomUUID()}`, id, input.reservationId, `${input.reservationId}:${state}`, state === "settled" ? "settled" : "rollback", state === "settled" ? settled - Number(row.reserved_units) : -Number(row.reserved_units), input.traceId ?? `trace_${randomUUID()}`]);
      return { reservation: reservationView(updated), replayed: false };
    });
  }

  async recordProviderCost(input) {
    required(input, "invocationId");
    const result = await this.pool.query("INSERT INTO visualization_provider_cost_ledger(cost_event_id, invocation_id, route_id, provider_id, provider_request_id, amount, currency, units, reason_code, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *", [`vcost_${randomUUID()}`, input.invocationId, input.routeId, input.providerId, input.providerRequestId, input.amount, input.currency, input.units ?? 0, input.reasonCode ?? "provider_cost", JSON.stringify(input.metadata ?? {})]);
    return result.rows[0];
  }

  async recordCacheReuse(subject, input) {
    const id = subjectId(subject);
    required(input, "idempotencyKey");
    await this.pool.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, policy_revision, trace_id) VALUES ($1,$2,NULL,$3,'cache_reuse',0,NULL,$4)", [`vusage_${randomUUID()}`, id, input.idempotencyKey, input.traceId ?? `trace_${randomUUID()}`]);
    return { recorded: true, units: 0 };
  }

  async findReusableArtifact(subject, input) {
    const id = subjectId(subject);
    const result = await this.pool.query("SELECT * FROM visualization_artifacts WHERE subject_id = $1 AND document_id = $2 AND modality = $3 AND spec_hash = $4 AND evidence_hash = $5 ORDER BY updated_at DESC LIMIT 1", [id, input.documentId, input.modality, input.specHash, input.evidenceHash]);
    return result.rows[0] ?? null;
  }
}
