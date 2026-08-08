import { createHash, randomUUID } from "node:crypto";
import { AccountLifecycleError } from "./accountLifecycleError.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const deletionStages = Object.freeze([
  "identity_disabled",
  "liteasy_cleaned",
  "intuecho_cleaned",
  "identity_delete_requested",
  "identity_deleted",
  "completed"
]);

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deletionView(row) {
  return {
    attempts: row.attempts,
    completedAt: row.completed_at?.toISOString() ?? null,
    jobId: row.job_id,
    lastCompletedStage: row.last_completed_stage,
    lastErrorCode: row.last_error_code,
    result: row.result,
    state: row.state,
    subjectId: row.subject_id,
    updatedAt: row.updated_at.toISOString()
  };
}

async function appendAudit(client, input) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type, resource_id,
      scope_type, scope_id, reason, trace_id, detail
    ) VALUES ($1, $2, 'liteasy-admin', $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  `, [
    `audit_${randomUUID()}`, input.actorId, input.action, input.resourceType,
    input.resourceId ?? null, input.scopeType ?? null, input.scopeId ?? null,
    input.reason ?? null, input.traceId, JSON.stringify(input.detail ?? {})
  ]);
}

export class PostgresAccountLifecycleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async beginOperation(input) {
    const hash = hashRequest({
      reason: input.reason,
      status: input.status,
      subjectId: input.subjectId
    });
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `account-lifecycle-operation:${input.actorId}:${input.idempotencyKey}`
      ]);
      const prior = await client.query(`
        SELECT * FROM account_lifecycle_operations
         WHERE actor_id = $1 AND idempotency_key = $2
      `, [input.actorId, input.idempotencyKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) {
          throw new AccountLifecycleError("idempotency_key_reused", 409);
        }
        if (prior.rows[0].state === "completed") {
          return { replayed: true, response: prior.rows[0].response_body };
        }
        if (
          prior.rows[0].state === "running" &&
          prior.rows[0].updated_at > new Date(Date.now() - 2 * 60 * 1000)
        ) {
          throw new AccountLifecycleError("account_lifecycle_in_progress", 409);
        }
        await client.query(`
          UPDATE account_lifecycle_operations
             SET state = 'running', attempts = attempts + 1, error_code = NULL, updated_at = now()
           WHERE actor_id = $1 AND idempotency_key = $2
        `, [input.actorId, input.idempotencyKey]);
        return { replayed: false };
      }
      await client.query(`
        INSERT INTO account_lifecycle_operations(
          actor_id, idempotency_key, request_hash, subject_id, requested_status, state
        ) VALUES ($1, $2, $3, $4, $5, 'running')
      `, [input.actorId, input.idempotencyKey, hash, input.subjectId, input.status]);
      return { replayed: false };
    });
  }

  async completeOperation(input, response) {
    await this.pool.query(`
      UPDATE account_lifecycle_operations
         SET state = 'completed', response_body = $3::jsonb, error_code = NULL,
             updated_at = now(), completed_at = now()
       WHERE actor_id = $1 AND idempotency_key = $2
    `, [input.actorId, input.idempotencyKey, JSON.stringify(response)]);
  }

  async failOperation(input, errorCode) {
    await this.pool.query(`
      UPDATE account_lifecycle_operations
         SET state = 'failed', response_body = NULL, error_code = $3,
             updated_at = now(), completed_at = NULL
       WHERE actor_id = $1 AND idempotency_key = $2 AND state <> 'completed'
    `, [input.actorId, input.idempotencyKey, errorCode]);
  }

  async projectStatus(input) {
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query(`
        INSERT INTO account_status_projections(
          subject_id, status, updated_by, reason, identity_updated_at
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(subject_id) DO UPDATE SET
          status = excluded.status, updated_by = excluded.updated_by,
          reason = excluded.reason, identity_updated_at = excluded.identity_updated_at,
          updated_at = now()
      `, [input.subjectId, input.status, input.actorId, input.reason, input.identityUpdatedAt]);
      await appendAudit(client, {
        action: "account_status_updated",
        actorId: input.actorId,
        detail: {
          allSessionsRevoked: input.allSessionsRevoked,
          revokedAudiences: input.revokedAudiences,
          status: input.status
        },
        reason: input.reason,
        resourceId: input.subjectId,
        resourceType: "account",
        traceId: input.traceId
      });
      return { status: input.status, subjectId: input.subjectId };
    });
  }

  async beginDeletion(input) {
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `account-deletion:${input.subjectId}`
      ]);
      const owned = await client.query(`
        SELECT organization_id FROM organizations
         WHERE owner_subject = $1 AND status <> 'deleted' LIMIT 1
      `, [input.subjectId]);
      if (owned.rows[0]) throw new AccountLifecycleError("account_owns_organization", 409);
      const prior = await client.query(
        "SELECT * FROM account_deletion_jobs WHERE subject_id = $1 FOR UPDATE",
        [input.subjectId]
      );
      if (prior.rows[0]?.state === "completed") return deletionView(prior.rows[0]);
      let result;
      if (prior.rows[0]) {
        result = await client.query(`
          UPDATE account_deletion_jobs
             SET state = 'requested', requested_by = $2, reason = $3,
                 attempts = attempts + 1, last_error_code = NULL, updated_at = now()
           WHERE subject_id = $1 RETURNING *
        `, [input.subjectId, input.actorId, input.reason]);
      } else {
        result = await client.query(`
          INSERT INTO account_deletion_jobs(
            subject_id, job_id, state, requested_by, reason
          ) VALUES ($1, $2, 'requested', $3, $4)
          RETURNING *
        `, [input.subjectId, `accountdelete_${randomUUID()}`, input.actorId, input.reason]);
      }
      return deletionView(result.rows[0]);
    });
  }

  async markDeletionStage(input) {
    if (!deletionStages.includes(input.stage)) {
      throw new AccountLifecycleError("account_deletion_stage_invalid", 500);
    }
    const completed = input.stage === "completed";
    const result = await this.pool.query(`
      UPDATE account_deletion_jobs
         SET state = $2, last_completed_stage = $2, last_error_code = NULL,
             result = result || $3::jsonb, updated_at = now(),
             completed_at = CASE WHEN $4 THEN now() ELSE NULL END
       WHERE subject_id = $1
         AND COALESCE(array_position($5::text[], last_completed_stage), 0)
             <= array_position($5::text[], $2)
       RETURNING *
    `, [
      input.subjectId,
      input.stage,
      JSON.stringify(input.result ?? {}),
      completed,
      deletionStages
    ]);
    if (!result.rows[0]) {
      const exists = await this.pool.query(
        "SELECT 1 FROM account_deletion_jobs WHERE subject_id = $1",
        [input.subjectId]
      );
      throw new AccountLifecycleError(
        exists.rows[0] ? "account_deletion_stage_regression" : "account_deletion_job_missing",
        500
      );
    }
    return deletionView(result.rows[0]);
  }

  async failDeletion(subjectId, errorCode) {
    await this.pool.query(`
      UPDATE account_deletion_jobs
         SET state = 'failed', last_error_code = $2, updated_at = now(), completed_at = NULL
       WHERE subject_id = $1 AND state <> 'completed'
    `, [subjectId, errorCode]);
  }

  async purgeLiteasyData(input) {
    return withPostgresTransaction(this.pool, async (client) => {
      const owned = await client.query(`
        SELECT organization_id FROM organizations
         WHERE owner_subject = $1 AND status <> 'deleted' LIMIT 1 FOR UPDATE
      `, [input.subjectId]);
      if (owned.rows[0]) throw new AccountLifecycleError("account_owns_organization", 409);

      const teamAnnotations = await client.query(
        "DELETE FROM team_annotations WHERE uploaded_by = $1",
        [input.subjectId]
      );
      const memberships = await client.query(
        "DELETE FROM organization_members WHERE member_subject = $1",
        [input.subjectId]
      );
      const invitations = await client.query(`
        DELETE FROM organization_invitations
         WHERE invited_subject = $1 OR accepted_by = $1 OR revoked_by = $1 OR created_by = $1
      `, [input.subjectId]);
      const supportGrants = await client.query(`
        UPDATE platform_support_access_grants
           SET revoked_by = $2, revoked_reason = $3, revoked_at = now()
         WHERE revoked_at IS NULL AND (grantee_subject = $1 OR (scope_type = 'user' AND scope_id = $1))
      `, [input.subjectId, input.actorId, input.reason]);
      const roleGrants = await client.query(`
        UPDATE platform_role_grants
           SET state = 'revoked', revoked_by = $2, revoked_reason = $3, revoked_at = now()
         WHERE subject_id = $1 AND state <> 'revoked'
      `, [input.subjectId, input.actorId, input.reason]);
      const entries = await client.query(
        "DELETE FROM library_entries WHERE scope_type = 'user' AND scope_id = $1",
        [input.subjectId]
      );
      const folders = await client.query(
        "DELETE FROM library_folders WHERE scope_type = 'user' AND scope_id = $1",
        [input.subjectId]
      );
      const scopeRevisions = await client.query(
        "DELETE FROM library_scope_revisions WHERE scope_type = 'user' AND scope_id = $1",
        [input.subjectId]
      );
      const storageQuotas = await client.query(
        "DELETE FROM storage_quotas WHERE scope_type = 'user' AND scope_id = $1",
        [input.subjectId]
      );
      const agentArtifacts = await client.query(
        "DELETE FROM agent_artifacts WHERE subject_id = $1",
        [input.subjectId]
      );
      const visualizationArtifacts = await client.query(
        "DELETE FROM visualization_artifacts WHERE subject_id = $1",
        [input.subjectId]
      );
      const visualizationPreferences = await client.query(
        "DELETE FROM visualization_user_preferences WHERE subject_id = $1",
        [input.subjectId]
      );
      const visualizationEntitlements = await client.query(
        "DELETE FROM visualization_entitlements WHERE subject_id = $1",
        [input.subjectId]
      );
      const visualizationQuotaPolicies = await client.query(
        "DELETE FROM visualization_quota_policies WHERE subject_id = $1",
        [input.subjectId]
      );
      const accountTables = [
        ["academic_profiles", "deletedAcademicProfiles"],
        ["local_library_manifest_entries", "deletedLocalLibraryManifestEntries"],
        ["personalization_signals", "deletedPersonalizationSignals"],
        ["personalization_terms", "deletedPersonalizationTerms"],
        ["recommendation_cache_entries", "deletedRecommendationCacheEntries"],
        ["recommendation_candidates", "deletedRecommendationCandidates"],
        ["recommendation_feedback", "deletedRecommendationFeedback"],
        ["recommendation_suppressions", "deletedRecommendationSuppressions"],
        ["personalization_states", "deletedPersonalizationStates"]
      ];
      const accountTableCounts = {};
      for (const [table, resultKey] of accountTables) {
        const deleted = await client.query(`DELETE FROM ${table} WHERE subject_id = $1`, [input.subjectId]);
        accountTableCounts[resultKey] = deleted.rowCount;
      }
      const idempotencyRecords = await client.query(
        "DELETE FROM idempotency_records WHERE actor_id = $1",
        [input.subjectId]
      );

      const result = {
        ...accountTableCounts,
        deletedEntries: entries.rowCount,
        deletedAgentArtifacts: agentArtifacts.rowCount,
        deletedVisualizationArtifacts: visualizationArtifacts.rowCount,
        deletedVisualizationPreferences: visualizationPreferences.rowCount,
        deletedVisualizationEntitlements: visualizationEntitlements.rowCount,
        deletedVisualizationQuotaPolicies: visualizationQuotaPolicies.rowCount,
        deletedFolders: folders.rowCount,
        deletedIdempotencyRecords: idempotencyRecords.rowCount,
        deletedInvitations: invitations.rowCount,
        deletedMemberships: memberships.rowCount,
        deletedScopeRevisions: scopeRevisions.rowCount,
        deletedStorageQuotas: storageQuotas.rowCount,
        deletedTeamAnnotations: teamAnnotations.rowCount,
        revokedPlatformRoles: roleGrants.rowCount,
        revokedSupportGrants: supportGrants.rowCount
      };
      const job = await client.query(`
        UPDATE account_deletion_jobs
           SET state = 'liteasy_cleaned', last_completed_stage = 'liteasy_cleaned',
               last_error_code = NULL, result = result || $2::jsonb, updated_at = now()
         WHERE subject_id = $1 RETURNING *
      `, [input.subjectId, JSON.stringify({ liteasy: result })]);
      if (!job.rows[0]) throw new AccountLifecycleError("account_deletion_job_missing", 500);
      await appendAudit(client, {
        action: "account_liteasy_data_deleted",
        actorId: input.actorId,
        detail: result,
        reason: input.reason,
        resourceId: input.subjectId,
        resourceType: "account",
        scopeId: input.subjectId,
        scopeType: "user",
        traceId: input.traceId
      });
      return { deletion: deletionView(job.rows[0]), result };
    });
  }
}
