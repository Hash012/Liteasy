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

function json(value, code = "visualization_json_invalid") {
  if (value === undefined || value === null) throw new Error(code);
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error(code);
    return encoded;
  } catch {
    throw new Error(code);
  }
}

function reasonCode(input) {
  if (typeof input?.reasonCode !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(input.reasonCode.trim())) {
    throw new Error("visualization_reason_code_invalid");
  }
  return input.reasonCode.trim();
}

function ianaTimezone(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("quota_timezone_invalid");
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); } catch { throw new Error("quota_timezone_invalid"); }
  return value;
}

function cacheField(input, name) {
  if (typeof input?.[name] !== "string" || input[name].trim() === "") {
    throw new Error(`visualization_${name}_invalid`);
  }
  return input[name].trim();
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

function providerRouteView(row) {
  return row ? {
    circuitFailures: Number(row.circuit_failures),
    circuitOpenUntil: row.circuit_open_until?.toISOString?.() ?? row.circuit_open_until ?? null,
    circuitState: row.circuit_state,
    dataClasses: row.data_classes ?? [],
    enabled: row.enabled,
    endpoint: row.endpoint,
    maxConcurrency: Number(row.max_concurrency),
    modalities: row.modalities ?? [],
    model: row.model,
    operations: row.operations ?? [],
    priority: Number(row.priority),
    providerId: row.provider_id,
    region: row.region,
    revision: Number(row.revision),
    routeId: row.route_id,
    secretRef: row.secret_ref,
    timeoutMs: Number(row.timeout_ms),
    updatedAt: row.updated_at?.toISOString?.() ?? null,
    updatedBy: row.updated_by
  } : null;
}

function quotaPolicyView(row) {
  return {
    dailyUnits: Number(row.daily_units),
    maxConcurrency: Number(row.max_concurrency),
    monthlyUnits: Number(row.monthly_units),
    reason: row.reason,
    revision: Number(row.revision),
    subjectId: row.subject_id,
    timezone: row.timezone,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
    updatedBy: row.updated_by
  };
}

function boundedLimit(value, fallback = 100) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error("visualization_list_limit_invalid");
  }
  return parsed;
}

function operationKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new Error("idempotency_key_invalid");
  }
  return value;
}

function routeId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(value)) {
    throw new Error("visualization_route_id_invalid");
  }
  return value;
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

  async getProviderRoute(routeInput) {
    const id = routeId(routeInput);
    const result = await this.pool.query(
      "SELECT * FROM visualization_provider_configs WHERE route_id = $1",
      [id]
    );
    return providerRouteView(result.rows[0]);
  }

  async listProviderRoutes() {
    const result = await this.pool.query(`
      SELECT * FROM visualization_provider_configs
       ORDER BY priority, route_id
    `);
    return { routes: result.rows.map(providerRouteView) };
  }

  async saveProviderRoute(input) {
    const route = input?.route;
    const id = routeId(route?.routeId);
    const actorId = subjectId(input?.updatedBy);
    const key = operationKey(input?.idempotencyKey);
    if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("visualization_route_revision_invalid");
    }
    if (typeof input?.reason !== "string" || input.reason.trim().length < 8 || input.reason.trim().length > 1000) {
      throw new Error("visualization_reason_invalid");
    }
    const hash = requestHash({
      expectedRevision: input.expectedRevision,
      reason: input.reason.trim(),
      route
    });
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `visualization-provider:${actorId}:${key}`
      ]);
      const prior = await client.query(`
        SELECT request_hash, response_body FROM idempotency_records
         WHERE actor_id = $1 AND operation = 'visualization-provider-save'
           AND idempotency_key = $2 AND expires_at > now()
      `, [actorId, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new Error("idempotency_key_reused");
        return prior.rows[0].response_body;
      }
      const current = await client.query(`
        SELECT * FROM visualization_provider_configs WHERE route_id = $1 FOR UPDATE
      `, [id]);
      const revision = Number(current.rows[0]?.revision ?? 0);
      if (revision !== input.expectedRevision) {
        throw new Error("visualization_route_revision_conflict");
      }
      const saved = await client.query(`
        INSERT INTO visualization_provider_configs(
          route_id, provider_id, endpoint, model, secret_ref, operations, modalities,
          data_classes, region, priority, timeout_ms, max_concurrency, enabled,
          circuit_state, circuit_failures, circuit_open_until, revision, updated_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18
        )
        ON CONFLICT(route_id) DO UPDATE SET
          provider_id = excluded.provider_id, endpoint = excluded.endpoint,
          model = excluded.model, secret_ref = excluded.secret_ref,
          operations = excluded.operations, modalities = excluded.modalities,
          data_classes = excluded.data_classes, region = excluded.region,
          priority = excluded.priority, timeout_ms = excluded.timeout_ms,
          max_concurrency = excluded.max_concurrency, enabled = excluded.enabled,
          circuit_state = excluded.circuit_state,
          circuit_failures = excluded.circuit_failures,
          circuit_open_until = excluded.circuit_open_until,
          revision = visualization_provider_configs.revision + 1,
          updated_by = excluded.updated_by, updated_at = now()
        RETURNING *
      `, [
        id,
        route.providerId,
        route.endpoint,
        route.model,
        route.secretRef,
        json(route.operations),
        json(route.modalities),
        json(route.dataClasses),
        route.region,
        route.priority,
        route.timeoutMs,
        route.maxConcurrency,
        route.enabled,
        route.circuitState,
        route.circuitFailures,
        route.circuitOpenUntil,
        revision + 1,
        actorId
      ]);
      const response = { route: providerRouteView(saved.rows[0]) };
      await client.query(`
        INSERT INTO audit_events(
          audit_id, actor_id, actor_audience, action, resource_type, resource_id,
          reason, trace_id, detail
        ) VALUES ($1,$2,'liteasy-admin','visualization_provider_saved',
          'visualization_provider',$3,$4,$5,$6::jsonb)
      `, [
        `audit_${randomUUID()}`,
        actorId,
        id,
        input.reason.trim(),
        required(input, "traceId"),
        json({ revision: response.route.revision })
      ]);
      await client.query(`
        INSERT INTO idempotency_records(
          actor_id, operation, idempotency_key, request_hash, response_status,
          response_body, expires_at
        ) VALUES ($1,'visualization-provider-save',$2,$3,200,$4::jsonb,now()+interval '24 hours')
      `, [actorId, key, hash, json(response)]);
      return response;
    });
  }

  async listQuotaPolicies(input = {}) {
    const limit = boundedLimit(input.limit);
    const requestedSubject = input.subjectId === undefined ? null : subjectId(input.subjectId);
    const result = await this.pool.query(`
      SELECT * FROM visualization_quota_policies
       WHERE ($1::text IS NULL OR subject_id = $1)
       ORDER BY updated_at DESC, subject_id
       LIMIT $2
    `, [requestedSubject, limit]);
    return { policies: result.rows.map(quotaPolicyView) };
  }

  async listUsage(input = {}) {
    const limit = boundedLimit(input.limit);
    const requestedSubject = input.subjectId === undefined ? null : subjectId(input.subjectId);
    const result = await this.pool.query(`
      SELECT event_id, subject_id, reservation_id, idempotency_key, event_type,
             units_delta, reason_code, trace_id, created_at
        FROM visualization_usage_ledger
       WHERE ($1::text IS NULL OR subject_id = $1)
       ORDER BY created_at DESC, event_id
       LIMIT $2
    `, [requestedSubject, limit]);
    return { rows: result.rows.map((row) => ({
      createdAt: row.created_at?.toISOString?.() ?? null,
      eventId: row.event_id,
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      reasonCode: row.reason_code,
      reservationId: row.reservation_id,
      subjectId: row.subject_id,
      traceId: row.trace_id,
      unitsDelta: Number(row.units_delta)
    })) };
  }

  async listAudit(input = {}) {
    const limit = boundedLimit(input.limit);
    const result = await this.pool.query(`
      SELECT audit_id, actor_id, action, resource_type, resource_id, reason,
             trace_id, detail, occurred_at
        FROM audit_events
       WHERE action LIKE 'visualization_%'
       ORDER BY occurred_at DESC, audit_id
       LIMIT $1
    `, [limit]);
    return { rows: result.rows.map((row) => ({
      action: row.action,
      actorId: row.actor_id,
      auditId: row.audit_id,
      detail: row.detail ?? {},
      occurredAt: row.occurred_at?.toISOString?.() ?? null,
      reason: row.reason,
      resourceId: row.resource_id,
      resourceType: row.resource_type,
      traceId: row.trace_id
    })) };
  }

  async capability(subject) {
    const id = subjectId(subject);
    const result = await this.pool.query(`
      SELECT e.*, p.enabled AS preference_enabled, p.revision AS preference_revision,
             q.daily_units, q.monthly_units, q.max_concurrency, q.timezone, q.revision AS policy_revision,
             COALESCE((SELECT SUM(u.units_delta) FROM visualization_usage_ledger u
                       LEFT JOIN visualization_quota_reservations r ON r.reservation_id = u.reservation_id
                       WHERE u.subject_id = e.subject_id
                         AND COALESCE(r.created_at, u.created_at) >= date_trunc('day', now(), COALESCE(q.timezone, 'UTC'))), 0) AS daily_used,
             COALESCE((SELECT SUM(u.units_delta) FROM visualization_usage_ledger u
                       LEFT JOIN visualization_quota_reservations r ON r.reservation_id = u.reservation_id
                       WHERE u.subject_id = e.subject_id
                         AND COALESCE(r.created_at, u.created_at) >= date_trunc('month', now(), COALESCE(q.timezone, 'UTC'))), 0) AS monthly_used,
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
    const dailyUsed = Number(row.daily_used ?? 0);
    const monthlyUsed = Number(row.monthly_used ?? 0);
    const dailyRemaining = Math.max(0, daily - dailyUsed);
    const monthlyRemaining = Math.max(0, monthly - monthlyUsed);
    const remaining = Math.min(dailyRemaining, monthlyRemaining);
    const limit = Math.max(1, Math.min(daily, monthly));
    const remainingBand = remaining <= 0 ? "none" : remaining / limit <= 0.1 ? "low" : "available";
    const allowedModalities = Array.isArray(row.allowed_modalities) ? row.allowed_modalities : [];
    return {
      allowed: Boolean(row.allowed),
      enabled: Boolean(row.allowed && row.preference_enabled !== false),
      serviceAvailable: true,
      availableModalities: allowedModalities,
      preference: rowPreference({ enabled: row.preference_enabled ?? true, revision: row.preference_revision ?? 1 }),
      quota: {
        available: true,
        dailyUnits: daily,
        monthlyUnits: monthly,
        usedUnits: dailyUsed,
        dailyUsedUnits: dailyUsed,
        monthlyUsedUnits: monthlyUsed,
        remainingBand,
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
        const response = prior.rows[0].response_body;
        return { replayed: true, ...(response?.reservation ? response : { reservation: reservationView(response) }) };
      }
      const entitlement = (await client.query("SELECT * FROM visualization_entitlements WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      const preference = (await client.query("SELECT * FROM visualization_user_preferences WHERE subject_id = $1", [id])).rows[0];
      const policy = (await client.query("SELECT * FROM visualization_quota_policies WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      if (!entitlement?.allowed || preference?.enabled === false) throw new Error("visualization_not_allowed");
      if (Array.isArray(entitlement.allowed_modalities) && entitlement.allowed_modalities.length > 0 && !entitlement.allowed_modalities.includes(input.modality)) throw new Error("visualization_modality_not_allowed");
      if (!policy) throw new Error("visualization_quota_unconfigured");
      await this.#expireReservations(client, id, input.traceId ?? `trace_${randomUUID()}`);
      const usage = await client.query(`
        SELECT
          COALESCE(SUM(u.units_delta) FILTER (WHERE COALESCE(r.created_at, u.created_at) >= date_trunc('day', now(), $2)), 0) AS daily_used,
          COALESCE(SUM(u.units_delta) FILTER (WHERE COALESCE(r.created_at, u.created_at) >= date_trunc('month', now(), $2)), 0) AS monthly_used
          FROM visualization_usage_ledger u
          LEFT JOIN visualization_quota_reservations r ON r.reservation_id = u.reservation_id
         WHERE u.subject_id = $1
      `, [id, ianaTimezone(policy.timezone ?? "UTC")]);
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
      const response = { reservation: reservationView(reservation) };
      await client.query("INSERT INTO idempotency_records(actor_id,operation,idempotency_key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,$4,201,$5::jsonb,now()+interval '1 day')", [id, "visualization-reserve", input.idempotencyKey, hash, JSON.stringify(response)]);
      return { replayed: false, ...response };
    });
  }

  async #expireReservations(client, id, traceId) {
    const expired = await client.query(`
      UPDATE visualization_quota_reservations
         SET state = 'expired', settled_units = 0, updated_at = now()
       WHERE subject_id = $1 AND state = 'reserved' AND expires_at <= now()
       RETURNING reservation_id, reserved_units, policy_revision
    `, [id]);
    for (const row of expired.rows) {
      await client.query(`
        INSERT INTO visualization_usage_ledger(
          event_id, subject_id, reservation_id, idempotency_key, event_type,
          units_delta, policy_revision, reason_code, trace_id
        ) VALUES ($1,$2,$3,$4,'expired',$5,$6,'reservation_expired',$7)
        ON CONFLICT (subject_id, idempotency_key) DO NOTHING
      `, [
        `vusage_${randomUUID()}`,
        id,
        row.reservation_id,
        `${row.reservation_id}:expired`,
        -Number(row.reserved_units),
        Number(row.policy_revision ?? 1),
        traceId
      ]);
    }
    return expired.rows.length;
  }

  async settle(subject, input) { return this.#transition(subject, input, "settled"); }
  async rollback(subject, input) { return this.#transition(subject, input, "rolled_back"); }

  async #transition(subject, input, state) {
    const id = subjectId(subject);
    required(input, "reservationId");
    const code = reasonCode(input);
    return withPostgresTransaction(this.pool, async (client) => {
      const row = (await client.query("SELECT * FROM visualization_quota_reservations WHERE reservation_id = $1 AND subject_id = $2 FOR UPDATE", [input.reservationId, id])).rows[0];
      if (!row) throw new Error("visualization_reservation_not_found");
      if (row.state !== "reserved") return { reservation: reservationView(row), replayed: true };
      const settled = state === "settled" ? input.settledUnits : 0;
      if (state === "settled" && (!Number.isInteger(settled) || settled < 0 || settled > Number(row.reserved_units))) {
        throw new Error("visualization_settled_units_invalid");
      }
      const updated = (await client.query("UPDATE visualization_quota_reservations SET state = $1, settled_units = $2, updated_at = now() WHERE reservation_id = $3 RETURNING *", [state, settled, input.reservationId])).rows[0];
      await client.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, reason_code, trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [`vusage_${randomUUID()}`, id, input.reservationId, `${input.reservationId}:${state}`, state === "settled" ? "settled" : "rollback", state === "settled" ? settled - Number(row.reserved_units) : -Number(row.reserved_units), code, input.traceId ?? `trace_${randomUUID()}`]);
      return { reservation: reservationView(updated), replayed: false };
    });
  }

  async recordProviderCost(input) {
    required(input, "invocationId");
    const routeId = required(input, "routeId");
    const providerId = required(input, "providerId");
    const providerRequestId = required(input, "providerRequestId");
    const code = reasonCode(input);
    if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount < 0) throw new Error("visualization_provider_cost_amount_invalid");
    if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) throw new Error("visualization_provider_cost_currency_invalid");
    if (!Number.isInteger(input.units) || input.units < 0) throw new Error("visualization_provider_cost_units_invalid");
    if (input.metadata !== undefined && (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata))) throw new Error("visualization_provider_cost_metadata_invalid");
    const result = await this.pool.query("INSERT INTO visualization_provider_cost_ledger(cost_event_id, invocation_id, route_id, provider_id, provider_request_id, amount, currency, units, reason_code, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (invocation_id, provider_request_id) DO NOTHING RETURNING *", [`vcost_${randomUUID()}`, input.invocationId, routeId, providerId, providerRequestId, input.amount, input.currency, input.units, code, json(input.metadata ?? {})]);
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
    const documentId = cacheField(input, "documentId");
    const modality = cacheField(input, "modality");
    const specHash = cacheField(input, "specHash");
    const evidenceHash = cacheField(input, "evidenceHash");
    const tenantId = cacheField(input, "tenantId");
    const locale = cacheField(input, "locale");
    const skillVersion = cacheField(input, "skillVersion");
    const kernelVersion = cacheField(input, "kernelVersion");
    const rendererVersion = cacheField(input, "rendererVersion");
    if (!Array.isArray(input.hardValidatorSet) || input.hardValidatorSet.length === 0) throw new Error("visualization_hard_validator_set_invalid");
    const sourceIdentityHash = cacheField(input, "sourceIdentityHash");
    const documentAccess = typeof input.documentAccess === "function" ? await input.documentAccess({ subjectId: id, tenantId, documentId }) : input.documentAccess === true;
    const sourceIdentity = typeof input.sourceIdentity === "function" ? await input.sourceIdentity({ subjectId: id, documentId, sourceIdentityHash }) : input.sourceIdentity === true;
    if (!documentAccess || !sourceIdentity) return null;
    return withPostgresTransaction(this.pool, async (client) => {
      const entitlementRow = (await client.query("SELECT * FROM visualization_entitlements WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      const preferenceRow = (await client.query("SELECT enabled FROM visualization_user_preferences WHERE subject_id = $1", [id])).rows[0];
      const entitlement = rowEntitlement(entitlementRow);
      if (!entitlement.allowed || preferenceRow?.enabled === false
        || (entitlement.allowedModalities.length > 0 && !entitlement.allowedModalities.includes(modality))) return null;
      const result = await client.query(`SELECT * FROM visualization_artifacts
        WHERE subject_id = $1 AND document_id = $2 AND modality = $3 AND spec_hash = $4 AND evidence_hash = $5
          AND body->>'tenantId' = $6 AND body->>'locale' = $7
          AND body->'versions'->>'skill' = $8 AND body->'versions'->>'kernel' = $9
          AND body->'versions'->>'renderer' = $10 AND body->'hardValidatorSet' = $11::jsonb
          AND body->>'sourceIdentityHash' = $12 AND state IN ('ready','degraded')
        ORDER BY updated_at DESC LIMIT 1`, [id, documentId, modality, specHash, evidenceHash, tenantId, locale, skillVersion, kernelVersion, rendererVersion, JSON.stringify(input.hardValidatorSet), sourceIdentityHash]);
      const artifact = result.rows[0] ?? null;
      if (artifact) {
        await client.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, reason_code, trace_id) VALUES ($1,$2,NULL,$3,'cache_reuse',0,$4,$5) ON CONFLICT (subject_id, idempotency_key) DO NOTHING", [`vusage_${randomUUID()}`, id, input.idempotencyKey ?? `cache_${requestHash({ tenantId, documentId, modality, specHash, evidenceHash, locale, skillVersion, kernelVersion, rendererVersion, hardValidatorSet: input.hardValidatorSet })}`, "cache_reuse", input.traceId ?? `trace_${randomUUID()}`]);
      }
      return artifact;
    });
  }
}
