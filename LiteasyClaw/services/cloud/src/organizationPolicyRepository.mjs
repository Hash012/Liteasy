import { createHash, randomUUID } from "node:crypto";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const exportPolicies = new Set(["disabled", "admins_only", "all_members"]);
const uploadPolicies = new Set(["owner_admins", "all_members"]);

function operationKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new LibraryRepositoryError("idempotency_key_invalid");
  }
  return value;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LibraryRepositoryError("organization_policy_revision_invalid");
  }
  return value;
}

function mapPolicy(row, role) {
  return {
    exportPolicy: row.export_policy,
    revision: Number(row.revision),
    role,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
    uploadPolicy: row.upload_policy
  };
}

export class PostgresOrganizationPolicyRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get(scope) {
    if (scope?.scopeType !== "organization" || !scope.scopeId) {
      throw new LibraryRepositoryError("library_scope_invalid");
    }
    const result = await this.pool.query(`
      SELECT * FROM organization_storage_policies WHERE organization_id = $1
    `, [scope.scopeId]);
    if (!result.rows[0]) throw new LibraryRepositoryError("organization_policy_not_found", 404);
    return mapPolicy(result.rows[0], scope.role);
  }

  async update(scope, input) {
    if (scope?.scopeType !== "organization" || !scope.scopeId) {
      throw new LibraryRepositoryError("library_scope_invalid");
    }
    if (scope.role !== "owner") throw new LibraryRepositoryError("organization_policy_owner_required", 403);
    if (!exportPolicies.has(input.exportPolicy) || !uploadPolicies.has(input.uploadPolicy)) {
      throw new LibraryRepositoryError("organization_policy_invalid");
    }
    const revision = expectedRevision(input.expectedRevision);
    const key = operationKey(input.idempotencyKey);
    const requestHash = createHash("sha256").update(JSON.stringify({
      exportPolicy: input.exportPolicy,
      organizationId: scope.scopeId,
      revision,
      uploadPolicy: input.uploadPolicy
    })).digest("hex");
    return withPostgresTransaction(this.pool, async (client) => {
      const operation = "update_organization_storage_policy";
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${input.actorId}:${operation}:${key}`
      ]);
      const prior = await client.query(`
        SELECT request_hash, response_body FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
      `, [input.actorId, operation, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) {
          throw new LibraryRepositoryError("idempotency_key_reused", 409);
        }
        return prior.rows[0].response_body;
      }
      const result = await client.query(`
        UPDATE organization_storage_policies
           SET export_policy = $2, upload_policy = $3, updated_by = $4,
               revision = revision + 1, updated_at = now()
         WHERE organization_id = $1 AND revision = $5
         RETURNING *
      `, [scope.scopeId, input.exportPolicy, input.uploadPolicy, input.actorId, revision]);
      if (!result.rows[0]) throw new LibraryRepositoryError("organization_policy_revision_conflict", 409);
      const response = mapPolicy(result.rows[0], scope.role);
      await client.query(`
        INSERT INTO idempotency_records(
          actor_id, operation, idempotency_key, request_hash, response_status,
          response_body, expires_at
        ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
      `, [input.actorId, operation, key, requestHash, JSON.stringify(response)]);
      await client.query(`
        INSERT INTO audit_events(
          audit_id, actor_id, actor_audience, action, resource_type,
          resource_id, scope_type, scope_id, trace_id, detail
        ) VALUES ($1, $2, 'liteasy-desktop', $3, 'organization_storage_policy',
          $4, 'organization', $4, $5, $6::jsonb)
      `, [
        `audit_${randomUUID()}`, input.actorId, operation, scope.scopeId,
        input.traceId, JSON.stringify({
          exportPolicy: input.exportPolicy,
          revision: response.revision,
          uploadPolicy: input.uploadPolicy
        })
      ]);
      return response;
    });
  }
}
