import { AccountLifecycleError } from "./accountLifecycleError.mjs";

const statuses = new Set(["active", "disabled", "deleted"]);
const identityDisabledStages = new Set([
  "identity_disabled",
  "liteasy_cleaned",
  "intuecho_cleaned",
  "identity_delete_requested",
  "identity_deleted"
]);
const liteasyCleanedStages = new Set([
  "liteasy_cleaned",
  "intuecho_cleaned",
  "identity_delete_requested",
  "identity_deleted"
]);
const intuechoCleanedStages = new Set([
  "intuecho_cleaned",
  "identity_delete_requested",
  "identity_deleted"
]);

function identifier(value, code) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(value)) {
    throw new AccountLifecycleError(code);
  }
  return value;
}

function reasonText(value) {
  if (typeof value !== "string") throw new AccountLifecycleError("admin_reason_invalid");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 8 || normalized.length > 1000) {
    throw new AccountLifecycleError("admin_reason_invalid");
  }
  return normalized;
}

function operationKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(value)) {
    throw new AccountLifecycleError("idempotency_key_invalid");
  }
  return value;
}

export class AccountLifecycleService {
  constructor(repository, identityAdminClient, intuechoLifecycleClient) {
    this.repository = repository;
    this.identityAdminClient = identityAdminClient;
    this.intuechoLifecycleClient = intuechoLifecycleClient;
  }

  async setStatus(principal, identity, input) {
    if (!principal?.roles?.includes("platform_admin")) {
      throw new AccountLifecycleError("platform_admin_required", 403);
    }
    const actorId = identifier(principal.subjectId, "identity_subject_invalid");
    const subjectId = identifier(input.subjectId, "identity_subject_invalid");
    const idempotencyKey = operationKey(input.idempotencyKey);
    const traceId = identifier(input.traceId, "trace_id_invalid");
    const reason = reasonText(input.reason);
    if (!statuses.has(input.status)) throw new AccountLifecycleError("account_status_invalid");
    if (actorId === subjectId && input.status !== "active") {
      throw new AccountLifecycleError("admin_self_disable_forbidden", 409);
    }
    const operation = { actorId, idempotencyKey, reason, status: input.status, subjectId, traceId };
    const claim = await this.repository.beginOperation(operation);
    if (claim.replayed) return claim.response;
    try {
      const response = input.status === "deleted"
        ? await this.#delete(operation, identity)
        : await this.#changeIdentityStatus(operation);
      await this.repository.completeOperation(operation, response);
      return response;
    } catch (error) {
      const code = typeof error?.internalCode === "string"
        ? error.internalCode
        : typeof error?.code === "string" ? error.code : "account_lifecycle_failed";
      await this.repository.failOperation(operation, code).catch(() => {});
      if (input.status === "deleted") {
        await this.repository.failDeletion(subjectId, code).catch(() => {});
      }
      if (error instanceof AccountLifecycleError) throw error;
      throw new AccountLifecycleError("account_lifecycle_pending_retry", 503);
    }
  }

  async #changeIdentityStatus(operation) {
    const identity = await this.identityAdminClient.setAccountStatus(operation);
    await this.repository.projectStatus({
      ...operation,
      allSessionsRevoked: identity.allSessionsRevoked,
      identityUpdatedAt: identity.updatedAt,
      revokedAudiences: identity.revokedAudiences
    });
    return {
      account: { status: identity.status, subjectId: identity.subjectId },
      sessionRevocation: {
        allSessionsRevoked: identity.allSessionsRevoked,
        audiences: identity.revokedAudiences
      }
    };
  }

  async #delete(operation, adminIdentity) {
    if (typeof adminIdentity?.token !== "string" || !adminIdentity.token) {
      throw new AccountLifecycleError("admin_access_token_required", 500);
    }
    const job = await this.repository.beginDeletion(operation);
    if (job.state === "completed") {
      return {
        account: { status: "deleted", subjectId: operation.subjectId },
        deletion: job,
        sessionRevocation: {
          allSessionsRevoked: true,
          audiences: ["liteasy-desktop", "intuecho-web", "liteasy-admin"]
        }
      };
    }
    let identityIsDisabled = identityDisabledStages.has(job.lastCompletedStage);
    try {
      let disabled;
      if (!identityIsDisabled) {
        disabled = await this.identityAdminClient.setAccountStatus({
          ...operation,
          idempotencyKey: `${operation.idempotencyKey}:disable`,
          status: "disabled"
        });
        identityIsDisabled = true;
        await this.repository.projectStatus({
          ...operation,
          allSessionsRevoked: disabled.allSessionsRevoked,
          identityUpdatedAt: disabled.updatedAt,
          revokedAudiences: disabled.revokedAudiences,
          status: "disabled"
        });
        await this.repository.markDeletionStage({
          result: { identityDisabledAt: disabled.updatedAt },
          stage: "identity_disabled",
          subjectId: operation.subjectId
        });
      }
      const liteasy = liteasyCleanedStages.has(job.lastCompletedStage)
        ? { result: job.result.liteasy ?? {} }
        : await this.repository.purgeLiteasyData(operation);
      const intuecho = intuechoCleanedStages.has(job.lastCompletedStage)
        ? { result: job.result.intuecho ?? {} }
        : await this.intuechoLifecycleClient.deleteAccount({
          adminAccessToken: adminIdentity.token,
          idempotencyKey: `${operation.idempotencyKey}:intuecho`,
          reason: operation.reason,
          subjectId: operation.subjectId
        });
      if (!intuechoCleanedStages.has(job.lastCompletedStage)) {
        await this.repository.markDeletionStage({
          result: { intuecho: intuecho.result },
          stage: "intuecho_cleaned",
          subjectId: operation.subjectId
        });
      }
      if (!new Set(["identity_delete_requested", "identity_deleted"]).has(job.lastCompletedStage)) {
        await this.repository.markDeletionStage({
          result: {},
          stage: "identity_delete_requested",
          subjectId: operation.subjectId
        });
      }
      let deleted;
      if (job.lastCompletedStage === "identity_deleted") {
        deleted = {
          allSessionsRevoked: true,
          revokedAudiences: ["liteasy-desktop", "intuecho-web", "liteasy-admin"],
          status: "deleted",
          subjectId: operation.subjectId,
          updatedAt: job.result.identityDeletedAt
        };
      } else {
        deleted = await this.identityAdminClient.setAccountStatus({
          ...operation,
          idempotencyKey: `${operation.idempotencyKey}:delete`,
          status: "deleted"
        });
        await this.repository.markDeletionStage({
          result: { identityDeletedAt: deleted.updatedAt },
          stage: "identity_deleted",
          subjectId: operation.subjectId
        });
      }
      await this.repository.projectStatus({
        ...operation,
        allSessionsRevoked: deleted.allSessionsRevoked,
        identityUpdatedAt: deleted.updatedAt,
        revokedAudiences: deleted.revokedAudiences,
        status: "deleted"
      });
      const deletion = await this.repository.markDeletionStage({
        result: { liteasy: liteasy.result },
        stage: "completed",
        subjectId: operation.subjectId
      });
      return {
        account: { status: "deleted", subjectId: operation.subjectId },
        deletion,
        sessionRevocation: {
          allSessionsRevoked: deleted.allSessionsRevoked,
          audiences: deleted.revokedAudiences
        }
      };
    } catch (error) {
      if (!identityIsDisabled) throw error;
      const pending = new AccountLifecycleError("account_lifecycle_pending_retry", 503);
      pending.internalCode = typeof error?.code === "string" ? error.code : "account_lifecycle_failed";
      throw pending;
    }
  }
}
