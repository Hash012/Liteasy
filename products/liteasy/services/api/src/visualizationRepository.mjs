import { createHash, randomUUID } from "node:crypto";
import { withPostgresTransaction } from "./postgres.mjs";

export class VisualizationRepositoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "VisualizationRepositoryError";
    this.code = code;
    this.status = status;
  }
}

function subjectId(input) {
  const value = typeof input === "string" ? input : input?.subjectId;
  if (!value || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error("visualization_subject_invalid");
  return value;
}

function required(input, name) {
  if (typeof input?.[name] !== "string" || input[name].trim() === "") throw new Error(`visualization_${name}_invalid`);
  return input[name].trim();
}

function publicationSources(input) {
  const values = Array.isArray(input?.documents)
    ? input.documents
    : input?.document
      ? [{ ...input.document, access: input.access, isPrimary: true }]
      : [];
  if (values.length < 1 || values.length > 256) throw new Error("visualization_source_invalid");
  const sources = values.map((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source) ||
      typeof source.documentId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(source.documentId) ||
      typeof source.sourceIdentityHash !== "string" || !/^[a-f0-9]{64}$/.test(source.sourceIdentityHash) ||
      typeof source.isPrimary !== "boolean" || source.access?.allowed !== true ||
      !new Set(["user", "organization"]).has(source.access.scopeType) ||
      typeof source.access.scopeId !== "string" || source.access.scopeId.length === 0 ||
      source.access.sourceIdentityHash !== source.sourceIdentityHash) {
      throw new Error("visualization_source_access_revoked");
    }
    return source;
  });
  if (new Set(sources.map(({ documentId }) => documentId)).size !== sources.length ||
    sources.filter(({ isPrimary }) => isPrimary).length !== 1) {
    throw new Error("visualization_source_invalid");
  }
  return sources;
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

function requestOrigin(value) {
  if (value === undefined) return "automatic";
  if (value !== "automatic" && value !== "explicit") throw new VisualizationRepositoryError("visualization_requested_by_invalid");
  return value;
}

function positiveUnits(value, code = "visualization_units_invalid") {
  if (!Number.isSafeInteger(value) || value <= 0) throw new VisualizationRepositoryError(code);
  return value;
}

function providerCostRecord(input) {
  const invocationId = required(input, "invocationId");
  const routeId = required(input, "routeId");
  const providerId = required(input, "providerId");
  const providerRequestId = required(input, "providerRequestId");
  const costReasonCode = reasonCode(input);
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount < 0) throw new Error("visualization_provider_cost_amount_invalid");
  if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) throw new Error("visualization_provider_cost_currency_invalid");
  if (!Number.isInteger(input.units) || input.units < 0) throw new Error("visualization_provider_cost_units_invalid");
  if (input.metadata !== undefined && (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata))) throw new Error("visualization_provider_cost_metadata_invalid");
  return { ...input, invocationId, metadata: input.metadata ?? {}, providerId, providerRequestId, reasonCode: costReasonCode, routeId };
}

function providerInvocationCompletion(input) {
  const invocationId = required(input, "invocationId");
  const state = input.state;
  if (!["succeeded", "failed", "cancelled", "timed_out"].includes(state)) throw new VisualizationRepositoryError("visualization_invocation_state_invalid");
  const responseHash = input.responseHash === undefined ? null : input.responseHash;
  if (responseHash !== null && (typeof responseHash !== "string" || !/^[a-f0-9]{64}$/.test(responseHash))) throw new VisualizationRepositoryError("visualization_invocation_hash_invalid");
  const providerRequestId = input.providerRequestId === undefined ? null : required(input, "providerRequestId");
  if (input.providerUnits !== undefined && (!Number.isSafeInteger(input.providerUnits) || input.providerUnits < 0)) {
    throw new VisualizationRepositoryError("visualization_provider_cost_units_invalid");
  }
  return {
    errorCode: input.errorCode ?? null,
    invocationId,
    providerRequestId,
    providerUnits: input.providerUnits ?? null,
    responseHash,
    state
  };
}

async function insertProviderCost(client, input) {
  const cost = providerCostRecord(input);
  const result = await client.query("INSERT INTO visualization_provider_cost_ledger(cost_event_id, invocation_id, route_id, provider_id, provider_request_id, amount, currency, units, reason_code, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (invocation_id, provider_request_id) DO NOTHING RETURNING *", [`vcost_${randomUUID()}`, cost.invocationId, cost.routeId, cost.providerId, cost.providerRequestId, cost.amount, cost.currency, cost.units, cost.reasonCode, json(cost.metadata)]);
  return result.rows[0];
}

async function completeProviderInvocationRow(client, input) {
  const completion = providerInvocationCompletion(input);
  const result = await client.query(`
    UPDATE visualization_provider_invocations
       SET state = $2, completed_at = COALESCE(completed_at, now()),
           provider_request_id = COALESCE($3, provider_request_id),
           response_hash = COALESCE(response_hash, $4), error_code = COALESCE(error_code, $5),
           provider_units = COALESCE($6, provider_units)
     WHERE invocation_id = $1 AND state = 'started'
     RETURNING *
  `, [completion.invocationId, completion.state, completion.providerRequestId, completion.responseHash, completion.errorCode, completion.providerUnits]);
  if (result.rows[0]) return { completed: true, row: result.rows[0] };
  const existing = await client.query(
    "SELECT * FROM visualization_provider_invocations WHERE invocation_id = $1",
    [completion.invocationId]
  );
  return { completed: false, row: existing.rows[0] ?? null };
}

function reservationView(row) {
  return row ? {
    reservationId: row.reservation_id,
    reservationGroupId: row.reservation_group_id ?? row.reservation_id,
    subjectId: row.subject_id,
    idempotencyKey: row.idempotency_key,
    modality: row.modality,
    routeId: row.route_id,
    routeRevision: Number(row.route_revision),
    policyRevision: Number(row.policy_revision),
    costTableRevision: Number(row.cost_table_revision ?? row.policy_revision ?? 1),
    requestedBy: row.requested_by ?? "automatic",
    reservedUnits: Number(row.reserved_units),
    settledUnits: row.settled_units == null ? null : Number(row.settled_units),
    state: row.state,
    expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at ?? null
  } : null;
}

async function appendVisualizationAudit(client, input) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type, resource_id,
      scope_type, scope_id, reason, trace_id, detail
    ) VALUES ($1,$2,'liteasy-admin',$3,$4,$5,'user',$5,$6,$7,$8::jsonb)
  `, [
    `audit_${randomUUID()}`,
    input.actorId,
    input.action,
    input.resourceType,
    input.subjectId,
    input.reason,
    input.traceId,
    json(input.detail)
  ]);
}

async function idempotentAdminMutation(client, input, mutate) {
  const hash = requestHash(input.requestBody);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `visualization-admin:${input.actorId}:${input.operation}:${input.idempotencyKey}`
  ]);
  const prior = await client.query(`
    SELECT request_hash, response_body FROM idempotency_records
     WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3
       AND expires_at > now()
  `, [input.actorId, input.operation, input.idempotencyKey]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== hash) throw new Error("idempotency_key_reused");
    return prior.rows[0].response_body;
  }
  const response = await mutate();
  await client.query(`
    INSERT INTO idempotency_records(
      actor_id, operation, idempotency_key, request_hash, response_status,
      response_body, expires_at
    ) VALUES ($1,$2,$3,$4,200,$5::jsonb,now()+interval '24 hours')
  `, [input.actorId, input.operation, input.idempotencyKey, hash, json(response)]);
  return response;
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

function costPolicyView(row) {
  return row ? {
    dataClass: row.data_class,
    enabled: row.enabled,
    modality: row.modality,
    operation: row.operation,
    providerId: row.provider_id,
    reason: row.reason,
    revision: Number(row.revision),
    unitCost: Number(row.unit_cost),
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at ?? null,
    updatedBy: row.updated_by
  } : null;
}

function routeCostPolicyCombinations(route) {
  const combinations = [];
  for (const modality of route.modalities ?? []) {
    for (const operation of route.operations ?? []) {
      for (const dataClass of route.dataClasses ?? []) {
        combinations.push({
          dataClass,
          modality,
          operation,
          providerId: route.providerId,
          unitCost: operation === "image_generation" ? 4 : 1
        });
      }
    }
  }
  return combinations;
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

function artifactView(row) {
  if (!row) return null;
  return {
    artifactId: row.artifact_id ?? row.artifactId,
    body: row.body ?? {},
    contentHash: row.content_hash ?? row.contentHash ?? null,
    documentId: row.document_id ?? row.documentId,
    evidenceHash: row.evidence_hash ?? row.evidenceHash,
    modality: row.modality,
    nodeId: row.node_id ?? row.nodeId ?? null,
    reservationId: row.reservation_id ?? row.reservationId ?? null,
    specHash: row.spec_hash ?? row.specHash,
    state: row.state,
    validation: row.validation ?? null
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

function auditListInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("visualization_audit_filter_invalid");
  }
  const allowed = new Set(["action", "from", "limit", "subjectId", "to"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error("visualization_audit_filter_invalid");
  }
  const date = (value) => {
    if (value === undefined) return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error("visualization_audit_date_invalid");
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error("visualization_audit_date_invalid");
    }
    return value;
  };
  const from = date(input.from);
  const to = date(input.to);
  if (from && to && from > to) throw new Error("visualization_audit_date_range_invalid");
  if (input.action !== undefined && (typeof input.action !== "string" || !/^visualization_[A-Za-z0-9._:-]{1,120}$/.test(input.action))) {
    throw new Error("visualization_audit_action_invalid");
  }
  return {
    action: input.action ?? null,
    from,
    limit: boundedLimit(input.limit),
    subjectId: input.subjectId === undefined ? null : subjectId(input.subjectId),
    to
  };
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

function reservationIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new VisualizationRepositoryError("visualization_reservation_invalid");
  }
  return value;
}

function providerProbeIdentity(input) {
  const routeIdentifier = routeId(input.routeId);
  const key = operationKey(input.idempotencyKey);
  const actorId = subjectId(input.actorId);
  const reason = required(input, "reason");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new VisualizationRepositoryError("visualization_route_revision_invalid");
  }
  return {
    actorId,
    hash: requestHash({ expectedRevision: input.expectedRevision, routeId: routeIdentifier, reason }),
    key,
    reason,
    routeIdentifier
  };
}

function providerProbeError(error) {
  const code = error?.code;
  const stableCode = new Set([
    "visualization_provider_timeout",
    "visualization_provider_unavailable",
    "visualization_request_aborted"
  ]).has(code) ? code : "visualization_provider_unavailable";
  const status = stableCode === "visualization_provider_timeout" ? 504
    : stableCode === "visualization_request_aborted" ? 499 : 503;
  return { code: stableCode, status };
}

function providerProbeResult(value) {
  const probe = value?.probe ?? value ?? {};
  if (probe.cancelled === true) return { cancelled: true };
  return {
    authenticated: probe.authenticated === true,
    capabilities: Array.isArray(probe.capabilities)
      ? probe.capabilities.filter((item) => typeof item === "string").slice(0, 32)
      : [],
    reachable: probe.reachable === true
  };
}

export class PostgresVisualizationRepository {
  constructor(pool, { now = () => new Date() } = {}) {
    this.pool = pool;
    this.now = now;
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
    const actorId = subjectId(input?.updatedBy ?? input?.actorId);
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
        WHERE visualization_provider_configs.revision = $19
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
        actorId,
        input.expectedRevision
      ]);
      if (!saved.rows[0]) throw new Error("visualization_route_revision_conflict");
      const costPolicies = [];
      for (const combination of routeCostPolicyCombinations(route)) {
        const policy = await client.query(`
          INSERT INTO visualization_cost_policies(
            modality, operation, data_class, provider_id, unit_cost, revision,
            enabled, updated_by, reason
          ) VALUES ($1,$2,$3,$4,$5,1,true,$6,$7)
          ON CONFLICT (modality, operation, data_class, provider_id, revision) DO NOTHING
          RETURNING *
        `, [
          combination.modality,
          combination.operation,
          combination.dataClass,
          combination.providerId,
          combination.unitCost,
          actorId,
          input.reason.trim()
        ]);
        if (policy.rows[0]) costPolicies.push(costPolicyView(policy.rows[0]));
      }
      const response = { route: providerRouteView(saved.rows[0]), costPolicies };
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
        input.traceId ?? `trace_${randomUUID()}`,
        json({ costPolicyCount: costPolicies.length, revision: response.route.revision })
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
    const filter = auditListInput(input);
    const result = await this.pool.query(`
      SELECT audit_id, actor_id, action, resource_type, resource_id, reason,
             trace_id, detail, occurred_at
        FROM audit_events
       WHERE action LIKE 'visualization_%'
         AND ($1::text IS NULL OR scope_id = $1)
         AND ($2::text IS NULL OR action = $2)
         AND ($3::date IS NULL OR occurred_at >= $3::date)
         AND ($4::date IS NULL OR occurred_at < ($4::date + interval '1 day'))
       ORDER BY occurred_at DESC, audit_id
       LIMIT $5
    `, [filter.subjectId, filter.action, filter.from, filter.to, filter.limit]);
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
    const currentTime = this.now();
    await withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`visualization-reserve:${id}`]);
      await this.#expireReservations(client, id, `trace_capability_expiry_${randomUUID()}`, currentTime);
    }, { isolation: "READ COMMITTED" });
    const result = await this.pool.query(`
      SELECT e.*, p.enabled AS preference_enabled, p.revision AS preference_revision,
             q.subject_id AS quota_subject_id, q.daily_units, q.monthly_units,
             q.max_concurrency, q.timezone, q.revision AS policy_revision,
             EXISTS(
               SELECT 1 FROM visualization_provider_configs route
                WHERE route.enabled = true AND route.circuit_state <> 'open'
                  AND EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements_text(route.operations) operation(value)
                      CROSS JOIN jsonb_array_elements_text(route.data_classes) data_class(value)
                      JOIN visualization_cost_policies cost
                        ON cost.provider_id = route.provider_id
                       AND cost.operation = operation.value
                       AND cost.data_class = data_class.value
                       AND cost.enabled = true
                     WHERE operation.value IN ('structured_generation','image_generation')
                  )
                  AND route.modalities ?| ARRAY(
                    SELECT jsonb_array_elements_text(e.allowed_modalities)
                  )
             ) AS route_available,
             COALESCE((
               SELECT jsonb_agg(modality ORDER BY modality)
                 FROM (
                   SELECT DISTINCT allowed_modality.value AS modality
                     FROM jsonb_array_elements_text(e.allowed_modalities) allowed_modality(value)
                     JOIN visualization_provider_configs route
                       ON route.enabled = true AND route.circuit_state <> 'open'
                      AND route.modalities ? allowed_modality.value
                     JOIN LATERAL jsonb_array_elements_text(route.operations) operation(value) ON true
                     JOIN LATERAL jsonb_array_elements_text(route.data_classes) data_class(value) ON true
                     JOIN visualization_cost_policies cost
                       ON cost.provider_id = route.provider_id
                      AND cost.modality = allowed_modality.value
                      AND cost.operation = operation.value
                      AND cost.data_class = data_class.value
                      AND cost.enabled = true
                      AND cost.operation IN ('structured_generation','image_generation')
                 ) available
             ), '[]'::jsonb) AS available_modalities,
             COALESCE((SELECT SUM(u.units_delta) FROM visualization_usage_ledger u
                       LEFT JOIN visualization_quota_reservations r ON r.reservation_id = u.reservation_id
                       WHERE u.subject_id = e.subject_id
                         AND COALESCE(r.created_at, u.created_at) >= date_trunc('day', $2::timestamptz, COALESCE(q.timezone, 'UTC'))), 0) AS daily_used,
             COALESCE((SELECT SUM(u.units_delta) FROM visualization_usage_ledger u
                       LEFT JOIN visualization_quota_reservations r ON r.reservation_id = u.reservation_id
                       WHERE u.subject_id = e.subject_id
                         AND COALESCE(r.created_at, u.created_at) >= date_trunc('month', $2::timestamptz, COALESCE(q.timezone, 'UTC'))), 0) AS monthly_used,
             (SELECT COUNT(DISTINCT COALESCE(r.reservation_group_id, r.reservation_id)) FROM visualization_quota_reservations r
               WHERE r.subject_id = e.subject_id AND r.state = 'reserved' AND r.expires_at > $2::timestamptz) AS active_count
        FROM visualization_entitlements e
        LEFT JOIN visualization_user_preferences p ON p.subject_id = e.subject_id
        LEFT JOIN visualization_quota_policies q ON q.subject_id = e.subject_id
       WHERE e.subject_id = $1
    `, [id, currentTime]);
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
    const policyAvailable = row.quota_subject_id != null;
    const routeAvailable = row.route_available === true;
    const availableModalities = policyAvailable && routeAvailable && Array.isArray(row.available_modalities)
      ? row.available_modalities
      : [];
    return {
      allowed: Boolean(row.allowed),
      explicitRequestsAllowed: Boolean(row.allowed && row.explicit_requests_allowed),
      enabled: Boolean(row.allowed && row.preference_enabled !== false),
      serviceAvailable: Boolean(row.allowed && policyAvailable && routeAvailable && availableModalities.length > 0),
      availableModalities,
      preference: rowPreference({ enabled: row.preference_enabled ?? true, revision: row.preference_revision ?? 1 }),
      quota: {
        available: Boolean(row.allowed && policyAvailable && routeAvailable && remaining > 0),
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
    if (typeof input?.enabled !== "boolean") throw new VisualizationRepositoryError("visualization_preference_invalid");
    const key = operationKey(input?.idempotencyKey);
    const traceId = required(input, "traceId");
    return withPostgresTransaction(this.pool, async (client) => {
      return idempotentAdminMutation(client, {
        actorId: id,
        idempotencyKey: key,
        operation: "visualization-preference-set",
        requestBody: { enabled: input.enabled, subjectId: id }
      }, async () => {
        const result = await client.query(`
          INSERT INTO visualization_user_preferences(subject_id, enabled, revision)
          VALUES ($1, $2, 1)
          ON CONFLICT(subject_id) DO UPDATE SET enabled = excluded.enabled,
            revision = visualization_user_preferences.revision + 1, updated_at = now()
          RETURNING *
        `, [id, input.enabled]);
        const response = { preference: rowPreference(result.rows[0]) };
        await client.query(`
          INSERT INTO audit_events(
            audit_id, actor_id, actor_audience, action, resource_type, resource_id,
            reason, trace_id, detail
          ) VALUES ($1,$2,'liteasy-desktop','visualization_preference_updated',
            'visualization_preference',$2,'preference_update',$3,$4::jsonb)
        `, [`audit_${randomUUID()}`, id, traceId, json({ enabled: input.enabled })]);
        return response;
      });
    });
  }

  async setEntitlement(subject, input) {
    const id = subjectId(subject);
    if (typeof input?.allowed !== "boolean") throw new Error("visualization_entitlement_invalid");
    const modalities = Array.isArray(input.allowedModalities) ? input.allowedModalities : [];
    if (input.allowed && (modalities.length === 0 || modalities.some((modality) => typeof modality !== "string" || modality.trim() === ""))) {
      throw new VisualizationRepositoryError("visualization_allowed_modalities_invalid");
    }
    const actorId = subjectId(input?.grantedBy);
    const key = operationKey(input?.idempotencyKey);
    if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("visualization_entitlement_revision_invalid");
    }
    const reason = required(input, "reason");
    const traceId = required(input, "traceId");
    return withPostgresTransaction(this.pool, async (client) => {
      return idempotentAdminMutation(client, {
        actorId,
        idempotencyKey: key,
        operation: "visualization-entitlement-set",
        requestBody: {
          allowed: input.allowed,
          allowedModalities: modalities,
          expectedRevision: input.expectedRevision,
          explicitRequestsAllowed: Boolean(input.explicitRequestsAllowed),
          reason,
          subjectId: id
        }
      }, async () => {
        const current = await client.query(`
          SELECT * FROM visualization_entitlements WHERE subject_id = $1 FOR UPDATE
        `, [id]);
        const revision = Number(current.rows[0]?.revision ?? 0);
        if (revision !== input.expectedRevision) throw new Error("visualization_entitlement_revision_conflict");
        const result = await client.query(`
          INSERT INTO visualization_entitlements(
            subject_id, allowed, explicit_requests_allowed, allowed_modalities,
            revision, granted_by, reason
          ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
          ON CONFLICT(subject_id) DO UPDATE SET allowed = excluded.allowed,
          explicit_requests_allowed = excluded.explicit_requests_allowed,
          allowed_modalities = excluded.allowed_modalities,
          revision = visualization_entitlements.revision + 1,
          granted_by = excluded.granted_by, reason = excluded.reason, updated_at = now()
        WHERE visualization_entitlements.revision = $8
          RETURNING *
        `, [
          id,
          input.allowed,
          Boolean(input.explicitRequestsAllowed),
          json(modalities),
          revision + 1,
          actorId,
          reason,
          input.expectedRevision
        ]);
        if (!result.rows[0]) throw new Error("visualization_entitlement_revision_conflict");
        if (input.allowed) {
          await client.query(`
            INSERT INTO visualization_user_preferences(subject_id, enabled)
            VALUES ($1, true) ON CONFLICT(subject_id) DO NOTHING
          `, [id]);
        }
        const response = { entitlement: rowEntitlement(result.rows[0]) };
        await appendVisualizationAudit(client, {
          action: "visualization_entitlement_updated",
          actorId,
          detail: { allowed: input.allowed, revision: response.entitlement.revision },
          reason,
          resourceType: "visualization_entitlement",
          subjectId: id,
          traceId
        });
        return response;
      });
    });
  }

  async setQuotaPolicy(subject, input) {
    const id = subjectId(subject);
    if (!Number.isInteger(input?.dailyUnits) || input.dailyUnits < 0 || !Number.isInteger(input?.monthlyUnits) || input.monthlyUnits < 0 || !Number.isInteger(input?.maxConcurrency) || input.maxConcurrency <= 0) throw new Error("quota_policy_invalid");
    if (!input.timezone) throw new Error("quota_timezone_invalid");
    try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(); } catch { throw new Error("quota_timezone_invalid"); }
    const reason = required(input, "reason");
    const actorId = subjectId(input?.updatedBy);
    const key = operationKey(input?.idempotencyKey);
    const traceId = required(input, "traceId");
    if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("visualization_quota_revision_invalid");
    }
    return withPostgresTransaction(this.pool, async (client) => {
      return idempotentAdminMutation(client, {
        actorId,
        idempotencyKey: key,
        operation: "visualization-quota-set",
        requestBody: {
          dailyUnits: input.dailyUnits,
          expectedRevision: input.expectedRevision,
          maxConcurrency: input.maxConcurrency,
          monthlyUnits: input.monthlyUnits,
          reason,
          subjectId: id,
          timezone: input.timezone
        }
      }, async () => {
        const current = await client.query(`
          SELECT * FROM visualization_quota_policies WHERE subject_id = $1 FOR UPDATE
        `, [id]);
        const revision = Number(current.rows[0]?.revision ?? 0);
        if (revision !== input.expectedRevision) throw new Error("visualization_quota_revision_conflict");
        const result = await client.query(`
          INSERT INTO visualization_quota_policies(
            subject_id, daily_units, monthly_units, max_concurrency, timezone,
            revision, updated_by, reason
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(subject_id) DO UPDATE SET daily_units = excluded.daily_units,
            monthly_units = excluded.monthly_units,
          max_concurrency = excluded.max_concurrency, timezone = excluded.timezone,
          revision = visualization_quota_policies.revision + 1,
          updated_by = excluded.updated_by, reason = excluded.reason, updated_at = now()
        WHERE visualization_quota_policies.revision = $9
          RETURNING *
        `, [
          id,
          input.dailyUnits,
          input.monthlyUnits,
          input.maxConcurrency,
          input.timezone,
          revision + 1,
          actorId,
          reason,
          input.expectedRevision
        ]);
        if (!result.rows[0]) throw new Error("visualization_quota_revision_conflict");
        const response = { policy: quotaPolicyView(result.rows[0]) };
        await appendVisualizationAudit(client, {
          action: "visualization_quota_updated",
          actorId,
          detail: { revision: response.policy.revision },
          reason,
          resourceType: "visualization_quota_policy",
          subjectId: id,
          traceId
        });
        return response;
      });
    });
  }

  async publish(subject, input) {
    const id = subjectId(subject);
    const reservationId = required(input, "reservationId");
    const auxiliaryReservationIds = input?.auxiliaryReservationIds ?? [];
    if (!Array.isArray(auxiliaryReservationIds) || auxiliaryReservationIds.length > 8 ||
      auxiliaryReservationIds.some((value) => typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) ||
      new Set([reservationId, ...auxiliaryReservationIds]).size !== auxiliaryReservationIds.length + 1) {
      throw new VisualizationRepositoryError("visualization_reservation_invalid");
    }
    const reservationIds = [reservationId, ...auxiliaryReservationIds].sort();
    const artifact = input?.artifact;
    const sources = publicationSources(input);
    const primarySource = sources.find(({ isPrimary }) => isPrimary);
    const documentId = primarySource.documentId;
    if (!artifact || typeof artifact !== "object" || input?.validation?.outcome !== "pass") {
      throw new Error("visualization_validation_failed");
    }
    return withPostgresTransaction(this.pool, async (client) => {
      const reservationRows = reservationIds.length === 1
        ? (await client.query(`
          SELECT * FROM visualization_quota_reservations
           WHERE reservation_id = $1 AND subject_id = $2 FOR UPDATE
        `, [reservationId, id])).rows
        : (await client.query(`
          SELECT * FROM visualization_quota_reservations
           WHERE reservation_id = ANY($1::text[]) AND subject_id = $2
           ORDER BY reservation_id FOR UPDATE
        `, [reservationIds, id])).rows;
      if (reservationRows.length !== reservationIds.length) throw new Error("visualization_reservation_not_found");
      const reservationsById = new Map(reservationRows.map((row) => [row.reservation_id, row]));
      const reservations = reservationIds.map((identifier) => reservationsById.get(identifier));
      const reservation = reservationsById.get(reservationId);
      if (reservations.some((row) => row.state !== "reserved")) {
        if (reservations.every((row) => row.state === "settled")) {
          const committed = (await client.query(`
            SELECT * FROM visualization_artifacts
             WHERE subject_id = $1 AND reservation_id = $2
             ORDER BY updated_at DESC LIMIT 1
          `, [id, reservationId])).rows[0];
          if (!committed) throw new Error("visualization_artifact_not_found");
          return {
            artifact: artifactView(committed),
            replayed: true,
            reservation: reservationView(reservation),
            reservations: reservations.map(reservationView)
          };
        }
        throw new Error("visualization_reservation_not_publishable");
      }
      if (reservations.some((row) => row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) {
        throw new Error("visualization_reservation_expired");
      }
      const entitlement = (await client.query(`
        SELECT * FROM visualization_entitlements WHERE subject_id = $1 FOR UPDATE
      `, [id])).rows[0];
      const preference = (await client.query(`
        SELECT enabled FROM visualization_user_preferences WHERE subject_id = $1 FOR UPDATE
      `, [id])).rows[0];
      const routeRows = reservationIds.length === 1
        ? (await client.query(`
          SELECT * FROM visualization_provider_configs WHERE route_id = $1 FOR UPDATE
        `, [reservation.route_id])).rows
        : (await client.query(`
          SELECT * FROM visualization_provider_configs
           WHERE route_id = ANY($1::text[]) ORDER BY route_id FOR UPDATE
        `, [[...new Set(reservations.map((row) => row.route_id))].sort()])).rows;
      const routesById = new Map(routeRows.map((row) => [row.route_id, row]));
      const route = routesById.get(reservation.route_id);
      if (!entitlement?.allowed || preference?.enabled === false ||
        !entitlement.allowed_modalities?.includes(reservation.modality)) {
        throw new Error("visualization_entitlement_revoked");
      }
      if (!route?.enabled || route.circuit_state === "open" ||
        Number(route.revision) !== Number(reservation.route_revision) ||
        input.routeId !== reservation.route_id || input.routeRevision !== Number(reservation.route_revision)) {
        throw new Error("visualization_route_revision_changed");
      }
      if (reservations.some((row) => {
        const currentRoute = routesById.get(row.route_id);
        return !currentRoute?.enabled || currentRoute.circuit_state === "open" ||
          Number(currentRoute.revision) !== Number(row.route_revision);
      })) {
        throw new Error("visualization_route_revision_changed");
      }
      for (const source of sources) {
        const current = (await client.query(`
          SELECT reference.content_hash
            FROM library_entries entry
            JOIN storage_object_references reference USING(document_id)
            JOIN storage_objects object ON object.content_hash = reference.content_hash
           WHERE entry.document_id = $1 AND entry.scope_type = $2 AND entry.scope_id = $3
             AND entry.entry_kind = 'pdf' AND entry.status = 'active'
             AND entry.availability = 'available' AND object.status = 'available'
             AND object.security_scan_hash = object.content_hash
             AND ($2 = 'user' AND $3 = $4 OR $2 = 'organization' AND EXISTS(
               SELECT 1 FROM organizations organization
               LEFT JOIN organization_members member
                 ON member.organization_id = organization.organization_id
                AND member.member_subject = $4
                WHERE organization.organization_id = $3 AND organization.status = 'active'
                  AND (organization.owner_subject = $4 OR member.status = 'active')
             ))
           FOR UPDATE OF entry, reference, object
        `, [source.documentId, source.access.scopeType, source.access.scopeId, id])).rows[0];
        if (!current || current.content_hash !== source.sourceIdentityHash) {
          throw new Error("visualization_source_access_revoked");
        }
      }
      if (reservations.some((row) => row.modality !== reservation.modality) ||
        new Set(reservations.map((row) => row.reservation_group_id ?? row.reservation_id)).size !== 1 ||
        (artifact.modality !== undefined && artifact.modality !== reservation.modality)) {
        throw new Error("visualization_artifact_modality_mismatch");
      }
      const insertedArtifact = await client.query(`
        INSERT INTO visualization_artifacts(
          subject_id, reservation_id, artifact_id, document_id, node_id, modality, state,
          spec_hash, evidence_hash, content_hash, body, validation
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
        ON CONFLICT(subject_id, artifact_id) DO NOTHING
        RETURNING *
      `, [
        id, reservationId, required(artifact, "artifactId"), documentId, artifact.nodeId ?? null,
        reservation.modality, artifact.state, artifact.specHash, artifact.evidenceHash,
        artifact.contentHash ?? null, json(artifact.body), json(input.validation)
      ]);
      if (!insertedArtifact.rows[0]) throw new Error("visualization_artifact_conflict");
      for (const source of sources) {
        await client.query(`
          INSERT INTO visualization_artifact_sources(
            subject_id, artifact_id, document_id, source_identity_hash, is_primary
          ) VALUES ($1,$2,$3,$4,$5)
        `, [id, required(artifact, "artifactId"), source.documentId, source.sourceIdentityHash, source.isPrimary]);
      }
      const updatedReservations = [];
      for (const currentReservation of reservations) {
        const settledUnits = Number(currentReservation.reserved_units);
        const updated = (await client.query(`
          UPDATE visualization_quota_reservations
             SET state = 'settled', settled_units = $2, updated_at = now()
           WHERE reservation_id = $1 RETURNING *
        `, [currentReservation.reservation_id, settledUnits])).rows[0];
        updatedReservations.push(updated);
        await client.query(`
          INSERT INTO visualization_usage_ledger(
            event_id, subject_id, reservation_id, idempotency_key, event_type,
            units_delta, policy_revision, cost_table_revision, reason_code, trace_id
          ) VALUES ($1,$2,$3,$4,'settled',$5,$6,$7,'completed',$8)
        `, [
          `vusage_${randomUUID()}`, id, currentReservation.reservation_id,
          `${currentReservation.reservation_id}:settled`,
          settledUnits - Number(currentReservation.reserved_units),
          Number(currentReservation.policy_revision),
          Number(currentReservation.cost_table_revision ?? currentReservation.policy_revision),
          required(input, "traceId")
        ]);
      }
      const updatedById = new Map(updatedReservations.map((row) => [row.reservation_id, row]));
      return {
        artifact: artifactView(insertedArtifact.rows[0]) ?? artifact,
        replayed: false,
        reservation: reservationView(updatedById.get(reservationId)),
        reservations: reservationIds.map((identifier) => reservationView(updatedById.get(identifier)))
      };
    });
  }

  async reserve(subject, input) {
    const id = subjectId(subject);
    const idempotencyKey = operationKey(input?.idempotencyKey);
    const modality = required(input, "modality");
    let routeIdentifier = input?.routeId === undefined ? null : routeId(input.routeId);
    const requestedBy = requestOrigin(input?.requestedBy);
    const requestedReservationGroupId = input?.reservationGroupId === undefined
      ? null
      : reservationIdentifier(input.reservationGroupId);
    const operation = input?.operation ?? (input?.imageGeneration ? "image_generation" : "structured_generation");
    if (!["structured_generation", "image_generation", "validation"].includes(operation)) {
      throw new VisualizationRepositoryError("visualization_operation_invalid");
    }
    const dataClass = typeof input?.dataClass === "string" && input.dataClass.trim() ? input.dataClass.trim() : "paper";
    const hash = requestHash({
      dataClass,
      modality,
      operation,
      requestedBy,
      reservationGroupId: requestedReservationGroupId,
      routeId: routeIdentifier
    });
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`visualization-reserve:${id}`]);
      const currentTime = this.now();
      const prior = await client.query("SELECT * FROM idempotency_records WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()", [id, "visualization-reserve", idempotencyKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new Error("idempotency_key_reused");
        const response = prior.rows[0].response_body;
        return { replayed: true, ...(response?.reservation ? response : { reservation: reservationView(response) }) };
      }
      const entitlement = (await client.query("SELECT * FROM visualization_entitlements WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      const preference = (await client.query("SELECT * FROM visualization_user_preferences WHERE subject_id = $1", [id])).rows[0];
      const policy = (await client.query("SELECT * FROM visualization_quota_policies WHERE subject_id = $1 FOR UPDATE", [id])).rows[0];
      if (!entitlement?.allowed || preference?.enabled === false) throw new VisualizationRepositoryError("visualization_not_allowed");
      if (requestedBy === "explicit" && entitlement.explicit_requests_allowed !== true) {
        throw new VisualizationRepositoryError("visualization_explicit_request_not_allowed", 403);
      }
      if (!Array.isArray(entitlement.allowed_modalities) || entitlement.allowed_modalities.length === 0 || !entitlement.allowed_modalities.includes(modality)) {
        throw new VisualizationRepositoryError("visualization_modality_not_allowed", 403);
      }
      if (!policy) throw new VisualizationRepositoryError("visualization_quota_unconfigured", 503);
      const route = (await client.query(routeIdentifier
        ? "SELECT * FROM visualization_provider_configs WHERE route_id = $1 FOR UPDATE"
        : `SELECT * FROM visualization_provider_configs
             WHERE enabled = true AND circuit_state <> 'open'
               AND operations ? $1 AND modalities ? $2 AND data_classes ? $3
             ORDER BY priority, route_id LIMIT 1 FOR UPDATE`,
      routeIdentifier ? [routeIdentifier] : [operation, modality, dataClass])).rows[0];
      if (!route?.enabled || route.circuit_state === "open" || !route.operations?.includes?.(operation) || !route.modalities?.includes?.(modality) || !route.data_classes?.includes?.(dataClass)) throw new VisualizationRepositoryError("visualization_route_unavailable", 503);
      routeIdentifier = route.route_id;
      const costPolicy = (await client.query(`
        SELECT * FROM visualization_cost_policies
         WHERE modality = $1 AND operation = $2 AND data_class = $3 AND provider_id = $4 AND enabled = true
         ORDER BY revision DESC
         LIMIT 1
         FOR UPDATE
      `, [modality, operation, dataClass, route.provider_id])).rows[0];
      if (!costPolicy) throw new VisualizationRepositoryError("visualization_cost_policy_unconfigured", 503);
      const reservedUnits = positiveUnits(Number(costPolicy.unit_cost));
      let reservationGroup;
      if (requestedReservationGroupId) {
        reservationGroup = (await client.query(`
          SELECT * FROM visualization_quota_reservations
           WHERE reservation_id = $1 AND subject_id = $2
             AND state = 'reserved' AND expires_at > $3 FOR UPDATE
        `, [requestedReservationGroupId, id, currentTime])).rows[0];
        if (!reservationGroup || reservationGroup.state !== "reserved" ||
          reservationGroup.modality !== modality ||
          (reservationGroup.reservation_group_id ?? reservationGroup.reservation_id) !== requestedReservationGroupId) {
          throw new VisualizationRepositoryError("visualization_reservation_group_invalid", 409);
        }
      }
      await this.#expireReservations(client, id, input.traceId ?? `trace_${randomUUID()}`, currentTime);
      const usage = await client.query(`
        SELECT
          COALESCE(SUM(u.units_delta) FILTER (WHERE COALESCE(r.created_at, u.created_at) >= date_trunc('day', $3::timestamptz, $2)), 0) AS daily_used,
          COALESCE(SUM(u.units_delta) FILTER (WHERE COALESCE(r.created_at, u.created_at) >= date_trunc('month', $3::timestamptz, $2)), 0) AS monthly_used
          FROM visualization_usage_ledger u
          LEFT JOIN visualization_quota_reservations r ON r.reservation_id = u.reservation_id
         WHERE u.subject_id = $1
      `, [id, ianaTimezone(policy.timezone ?? "UTC"), currentTime]);
      const active = await client.query("SELECT COUNT(DISTINCT COALESCE(reservation_group_id, reservation_id)) AS active_count FROM visualization_quota_reservations WHERE subject_id = $1 AND state = 'reserved' AND expires_at > $2", [id, currentTime]);
      if (Number(usage.rows[0]?.daily_used ?? usage.rows[0]?.used_units ?? 0) + reservedUnits > Number(policy.daily_units)
        || Number(usage.rows[0]?.monthly_used ?? 0) + reservedUnits > Number(policy.monthly_units)) throw new Error("visualization_quota_exceeded");
      if (!reservationGroup && Number(active.rows[0]?.active_count ?? 0) >= Number(policy.max_concurrency)) {
        throw new VisualizationRepositoryError("visualization_concurrency_exceeded", 429);
      }
      const reservationId = input.reservationId ?? `vizres_${randomUUID()}`;
      const reservationGroupId = requestedReservationGroupId ?? reservationId;
      const ttlMs = input.ttlMs ?? 120000;
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) throw new VisualizationRepositoryError("visualization_reservation_ttl_invalid");
      const requestedExpiresAt = new Date(currentTime.getTime() + ttlMs);
      const expiresAt = reservationGroup
        ? new Date(Math.min(requestedExpiresAt.getTime(), new Date(reservationGroup.expires_at).getTime()))
        : requestedExpiresAt;
      const routeRevision = Number(route.revision);
      const policyRevision = Number(policy.revision);
      const costTableRevision = Number(costPolicy.revision);
      const result = await client.query(`INSERT INTO visualization_quota_reservations(reservation_id, subject_id, idempotency_key, modality, route_id, route_revision, policy_revision, requested_by, cost_table_revision, reserved_units, reservation_group_id, state, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved',$12) RETURNING *`, [reservationId, id, idempotencyKey, modality, routeIdentifier, routeRevision, policyRevision, requestedBy, costTableRevision, reservedUnits, reservationGroupId, expiresAt]);
      const reservation = result.rows[0];
      await client.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, policy_revision, cost_table_revision, trace_id) VALUES ($1,$2,$3,$4,'reserved',$5,$6,$7,$8)", [`vusage_${randomUUID()}`, id, reservationId, idempotencyKey, reservedUnits, policyRevision, costTableRevision, input.traceId ?? `trace_${randomUUID()}`]);
      const response = { reservation: reservationView(reservation) };
      await client.query("INSERT INTO idempotency_records(actor_id,operation,idempotency_key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,$4,201,$5::jsonb,now()+interval '1 day')", [id, "visualization-reserve", idempotencyKey, hash, JSON.stringify(response)]);
      return { replayed: false, ...response };
    }, { isolation: "READ COMMITTED" });
  }

  async #expireReservations(client, id, traceId, currentTime) {
    const expired = await client.query(`
      UPDATE visualization_quota_reservations
         SET state = 'expired', settled_units = 0, updated_at = now()
       WHERE subject_id = $1 AND state = 'reserved' AND expires_at <= $2
       RETURNING reservation_id, reserved_units, policy_revision, cost_table_revision
    `, [id, currentTime]);
    for (const row of expired.rows) {
      await client.query(`
        INSERT INTO visualization_usage_ledger(
          event_id, subject_id, reservation_id, idempotency_key, event_type,
          units_delta, policy_revision, cost_table_revision, reason_code, trace_id
        ) VALUES ($1,$2,$3,$4,'expired',$5,$6,$7,'reservation_expired',$8)
        ON CONFLICT (subject_id, idempotency_key) DO NOTHING
      `, [
        `vusage_${randomUUID()}`,
        id,
        row.reservation_id,
        `${row.reservation_id}:expired`,
        -Number(row.reserved_units),
        Number(row.policy_revision ?? 1),
        Number(row.cost_table_revision ?? row.policy_revision ?? 1),
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
      const settled = state === "settled" ? Number(row.reserved_units) : 0;
      const updated = (await client.query("UPDATE visualization_quota_reservations SET state = $1, settled_units = $2, updated_at = now() WHERE reservation_id = $3 RETURNING *", [state, settled, input.reservationId])).rows[0];
      const delta = state === "settled" ? settled - Number(row.reserved_units) : -Number(row.reserved_units);
      await client.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, policy_revision, cost_table_revision, reason_code, trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [`vusage_${randomUUID()}`, id, input.reservationId, `${input.reservationId}:${state}`, state === "settled" ? "settled" : "rollback", delta, Number(row.policy_revision ?? 1), Number(row.cost_table_revision ?? row.policy_revision ?? 1), code, input.traceId ?? `trace_${randomUUID()}`]);
      return { reservation: reservationView(updated), replayed: false };
    });
  }

  async recordProviderCost(input) {
    return insertProviderCost(this.pool, input);
  }

  async startProviderInvocation(input) {
    const invocationId = required(input, "invocationId");
    const reservationId = required(input, "reservationId");
    const subject = subjectId(input.subjectId);
    const routeIdentifier = routeId(input.routeId);
    const providerRequestId = input.providerRequestId === undefined ? invocationId : required(input, "providerRequestId");
    const idempotencyKey = operationKey(input.idempotencyKey);
    if (!Number.isSafeInteger(input.routeRevision) || input.routeRevision < 1) throw new VisualizationRepositoryError("visualization_route_revision_invalid");
    if (!["structured_generation", "image_generation", "validation"].includes(input.operation)) throw new VisualizationRepositoryError("visualization_operation_invalid");
    const result = await this.pool.query(`
      INSERT INTO visualization_provider_invocations(
        invocation_id, reservation_id, subject_id, route_id, route_revision,
        idempotency_key, provider_request_id, operation, state, response_max_bytes,
        data_class, modality
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'started',$9,$10,$11)
      ON CONFLICT (reservation_id, idempotency_key) DO NOTHING
      RETURNING *
    `, [
      invocationId, reservationId, subject, routeIdentifier, input.routeRevision,
      idempotencyKey, providerRequestId, input.operation,
      Number.isSafeInteger(input.responseMaxBytes) && input.responseMaxBytes > 0 ? input.responseMaxBytes : 2 * 1024 * 1024,
      input.dataClass ?? null, input.modality ?? null
    ]);
    if (result.rows[0]) {
      result.rows[0].replayed = false;
      return result.rows[0];
    }
    const existing = await this.pool.query(`
      SELECT * FROM visualization_provider_invocations
       WHERE reservation_id = $1 AND idempotency_key = $2
       ORDER BY started_at DESC
       LIMIT 1
    `, [reservationId, idempotencyKey]);
    const row = existing.rows[0];
    if (!row) return null;
    if (row.reservation_id !== reservationId || row.idempotency_key !== idempotencyKey ||
      row.route_id !== routeIdentifier || Number(row.route_revision) !== input.routeRevision) {
      throw new VisualizationRepositoryError("idempotency_key_reused", 409);
    }
    row.replayed = true;
    return row;
  }

  async completeProviderInvocation(input) {
    return (await completeProviderInvocationRow(this.pool, input)).row;
  }

  async finalizeProviderInvocation(input) {
    const completion = providerInvocationCompletion(input);
    if (input.cost?.invocationId !== undefined && input.cost.invocationId !== completion.invocationId) {
      throw new VisualizationRepositoryError("visualization_invocation_identity_invalid");
    }
    return withPostgresTransaction(this.pool, async (client) => {
      const finalized = await completeProviderInvocationRow(client, completion);
      if (finalized.completed && input.cost) await insertProviderCost(client, input.cost);
      return finalized.row;
    });
  }

  async recordProviderInvocation(input) {
    const started = await this.startProviderInvocation(input);
    await this.completeProviderInvocation(input);
    return started;
  }

  async getProviderProbeReplay(input) {
    const { actorId, hash, key } = providerProbeIdentity(input);
    const prior = await this.pool.query(`
      SELECT request_hash, response_body FROM idempotency_records
       WHERE actor_id = $1 AND operation = 'visualization-provider-probe'
         AND idempotency_key = $2 AND expires_at > now()
    `, [actorId, key]);
    if (!prior.rows[0]) return null;
    if (prior.rows[0].request_hash !== hash) {
      throw new VisualizationRepositoryError("idempotency_key_reused", 409);
    }
    if (prior.rows[0].response_body?.state === "pending") return null;
    return { ...prior.rows[0].response_body, replayed: true };
  }

  async claimProviderProbe(input) {
    const { actorId, hash, key, reason, routeIdentifier } = providerProbeIdentity(input);
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`visualization-probe:${routeIdentifier}:${key}`]);
      const prior = await client.query(`
        SELECT request_hash, response_body FROM idempotency_records
         WHERE actor_id = $1 AND operation = 'visualization-provider-probe'
           AND idempotency_key = $2 AND expires_at > now()
         FOR UPDATE
      `, [actorId, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new VisualizationRepositoryError("idempotency_key_reused", 409);
        if (prior.rows[0].response_body?.state === "pending") return { pending: true, replayed: false };
        return { ...prior.rows[0].response_body, replayed: true };
      }
      const route = (await client.query("SELECT * FROM visualization_provider_configs WHERE route_id = $1 FOR UPDATE", [routeIdentifier])).rows[0];
      if (!route || Number(route.revision) !== Number(input.expectedRevision)) {
        throw new VisualizationRepositoryError("visualization_route_revision_conflict", 409);
      }
      await client.query(`
        INSERT INTO idempotency_records(
          actor_id, operation, idempotency_key, request_hash, response_status,
          response_body, expires_at
        ) VALUES ($1,'visualization-provider-probe',$2,$3,202,$4::jsonb,now()+interval '24 hours')
      `, [actorId, key, hash, json({ state: "pending" })]);
      return { claimed: true, replayed: false, route: providerRouteView(route) };
    });
  }

  async recordProviderProbe(input) {
    const { actorId, hash, key, reason, routeIdentifier } = providerProbeIdentity(input);
    const traceId = required(input, "traceId");
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`visualization-probe:${routeIdentifier}:${key}`]);
      const prior = await client.query("SELECT request_hash, response_body FROM idempotency_records WHERE actor_id = $1 AND operation = 'visualization-provider-probe' AND idempotency_key = $2 AND expires_at > now()", [actorId, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new VisualizationRepositoryError("idempotency_key_reused", 409);
        if (prior.rows[0].response_body?.state !== "pending") return { ...prior.rows[0].response_body, replayed: true };
      }
      const cancellation = input.result?.cancelled === true || input.probe?.cancelled === true;
      const failure = input.error ? providerProbeError(input.error)
        : cancellation ? providerProbeError({ code: "visualization_request_aborted" }) : null;
      const response = failure ? {
        error: failure,
        replayed: false,
        routeId: routeIdentifier,
        routeRevision: Number(input.expectedRevision)
      } : {
        probe: providerProbeResult(input.result ?? input.probe),
        replayed: false,
        routeId: routeIdentifier,
        routeRevision: Number(input.expectedRevision)
      };
      await client.query(`
        INSERT INTO audit_events(audit_id, actor_id, actor_audience, action, resource_type, resource_id, reason, trace_id, detail)
        VALUES ($1,$2,'liteasy-admin','visualization_provider_probe','visualization_provider',$3,$4,$5,$6::jsonb)
      `, [`audit_${randomUUID()}`, actorId, routeIdentifier, reason, traceId, json({
        ...(failure ? { error: failure } : { probe: response.probe }),
        redacted: true,
        routeId: routeIdentifier,
        routeRevision: Number(input.expectedRevision)
      })]);
      await client.query(`
        UPDATE idempotency_records
           SET response_status = $4, response_body = $5::jsonb
         WHERE actor_id = $1 AND operation = 'visualization-provider-probe'
           AND idempotency_key = $2 AND request_hash = $3
      `, [actorId, key, hash, failure?.status ?? 200, json(response)]);
      return response;
    });
  }

  async recordCacheReuse(subject, input) {
    const id = subjectId(subject);
    required(input, "idempotencyKey");
    await this.pool.query("INSERT INTO visualization_usage_ledger(event_id, subject_id, reservation_id, idempotency_key, event_type, units_delta, policy_revision, trace_id) VALUES ($1,$2,NULL,$3,'cache_reuse',0,NULL,$4)", [`vusage_${randomUUID()}`, id, input.idempotencyKey, input.traceId ?? `trace_${randomUUID()}`]);
    return { recorded: true, units: 0 };
  }

  async getPublishedArtifacts(subject, artifactIdsInput) {
    const id = subjectId(subject);
    if (!Array.isArray(artifactIdsInput) || artifactIdsInput.length < 1 || artifactIdsInput.length > 2) {
      throw new VisualizationRepositoryError("visualization_result_artifacts_invalid");
    }
    const artifactIds = artifactIdsInput.map((artifactId) => {
      if (typeof artifactId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(artifactId)) {
        throw new VisualizationRepositoryError("visualization_result_artifacts_invalid");
      }
      return artifactId;
    });
    if (new Set(artifactIds).size !== artifactIds.length) {
      throw new VisualizationRepositoryError("visualization_result_artifacts_invalid");
    }
    const result = await this.pool.query(`
      SELECT * FROM visualization_artifacts
       WHERE subject_id = $1 AND artifact_id = ANY($2::text[])
         AND state IN ('ready','degraded')
    `, [id, artifactIds]);
    const byId = new Map(result.rows.map((row) => [row.artifact_id, artifactView(row)]));
    if (artifactIds.some((artifactId) => !byId.has(artifactId))) {
      throw new VisualizationRepositoryError("visualization_artifact_not_found", 404);
    }
    return artifactIds.map((artifactId) => byId.get(artifactId));
  }

  async getPublishedRasterAsset(subject, sha256) {
    const id = subjectId(subject);
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new VisualizationRepositoryError("visualization_raster_asset_invalid");
    }
    const result = await this.pool.query(`
      SELECT artifact_id, body #> '{spec,payload,asset}' AS asset
        FROM visualization_artifacts
       WHERE subject_id = $1 AND modality = 'raster_illustration'
         AND state IN ('ready','degraded')
         AND body #>> '{spec,payload,asset,sha256}' = $2
       ORDER BY updated_at DESC LIMIT 1
    `, [id, sha256]);
    if (!result.rows[0]) {
      throw new VisualizationRepositoryError("visualization_raster_asset_not_found", 404);
    }
    return {
      artifactId: result.rows[0].artifact_id,
      asset: result.rows[0].asset
    };
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
        || entitlement.allowedModalities.length === 0 || !entitlement.allowedModalities.includes(modality)) return null;
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
