import assert from "node:assert/strict";
import test from "node:test";
import { AccountLifecycleError } from "./accountLifecycleError.mjs";
import { AccountLifecycleService } from "./accountLifecycleService.mjs";

function harness(overrides = {}) {
  const calls = [];
  const repository = {
    async beginDeletion(input) {
      calls.push(["beginDeletion", input.subjectId]);
      return { lastCompletedStage: null, result: {}, state: "requested" };
    },
    async beginOperation(input) { calls.push(["beginOperation", input.status]); return { replayed: false }; },
    async completeOperation(_input, response) { calls.push(["completeOperation", response.account.status]); },
    async failDeletion(_subjectId, code) { calls.push(["failDeletion", code]); },
    async failOperation(_input, code) { calls.push(["failOperation", code]); },
    async markDeletionStage(input) {
      calls.push(["stage", input.stage, input.result]);
      return { ...input, jobId: "job_1", lastCompletedStage: input.stage, state: input.stage };
    },
    async projectStatus(input) { calls.push(["projectStatus", input.status]); },
    async purgeLiteasyData() {
      calls.push(["purgeLiteasyData"]);
      return { result: {
        deletedEntries: 1,
        deletedVisualizationArtifactSources: 1,
        deletedVisualizationGenerationRequests: 1
      } };
    },
    ...overrides.repository
  };
  const identityAdminClient = {
    async setAccountStatus(input) {
      calls.push(["identity", input.status]);
      return {
        allSessionsRevoked: input.status !== "active",
        revokedAudiences: input.status === "active" ? [] : ["intuecho-web", "liteasy-admin", "liteasy-desktop", "liteasy-mobile"],
        status: input.status,
        subjectId: input.subjectId,
        updatedAt: "2026-08-07T00:00:00.000Z"
      };
    },
    ...overrides.identityAdminClient
  };
  const intuechoLifecycleClient = {
    async deleteAccount(input) {
      calls.push(["intuecho", input.adminAccessToken]);
      return { result: { deletedDrafts: 1 } };
    },
    ...overrides.intuechoLifecycleClient
  };
  return {
    calls,
    service: new AccountLifecycleService(repository, identityAdminClient, intuechoLifecycleClient)
  };
}

const principal = { roles: ["platform_admin"], subjectId: "admin_1" };
const identity = { token: "admin-token" };
const deletion = {
  idempotencyKey: "delete-user-0001",
  reason: "Approved account deletion",
  status: "deleted",
  subjectId: "user_1",
  traceId: "trace_1"
};
const deletionReceipt = {
  allSessionsRevoked: true,
  revokedAudiences: ["intuecho-web", "liteasy-admin", "liteasy-desktop", "liteasy-mobile"],
  status: "deleted",
  subjectId: "user_1",
  updatedAt: "2026-08-07T00:00:00.000Z"
};

test("disables identity first and deletes it only after both business services finish", async () => {
  const instance = harness();
  const result = await instance.service.setStatus(principal, identity, deletion);
  assert.equal(result.account.status, "deleted");
  const sequence = instance.calls.map((item) => item[0]);
  assert.ok(sequence.indexOf("identity") < sequence.indexOf("purgeLiteasyData"));
  assert.ok(sequence.indexOf("purgeLiteasyData") < sequence.indexOf("intuecho"));
  assert.ok(sequence.lastIndexOf("identity") > sequence.indexOf("intuecho"));
  assert.deepEqual(instance.calls.filter((item) => item[0] === "identity").map((item) => item[1]), [
    "disabled", "deleted"
  ]);
  assert.deepEqual(result.deletion.result.liteasy, {
    deletedEntries: 1,
    deletedVisualizationArtifactSources: 1,
    deletedVisualizationGenerationRequests: 1
  });
  assert.deepEqual(instance.calls.find((item) => item[0] === "stage" && item[1] === "identity_deleted")[2].identityDeletionReceipt, deletionReceipt);
});

test("does not allow the current administrator to disable or delete itself", async () => {
  const instance = harness();
  await assert.rejects(() => instance.service.setStatus(principal, identity, {
    ...deletion,
    subjectId: "admin_1"
  }), /admin_self_disable_forbidden/);
  assert.equal(instance.calls.length, 0);
});

test("keeps a failed deletion retryable and records the stable failure", async () => {
  const instance = harness({ intuechoLifecycleClient: {
    async deleteAccount() { throw Object.assign(new Error("private upstream detail"), { code: "intuecho_lifecycle_unavailable" }); }
  } });
  await assert.rejects(() => instance.service.setStatus(principal, identity, deletion), /account_lifecycle_pending_retry/);
  assert.deepEqual(instance.calls.find((item) => item[0] === "failOperation"), [
    "failOperation", "intuecho_lifecycle_unavailable"
  ]);
  assert.deepEqual(instance.calls.find((item) => item[0] === "failDeletion"), [
    "failDeletion", "intuecho_lifecycle_unavailable"
  ]);
});

test("preserves a deletion precondition error before the identity is disabled", async () => {
  const instance = harness({ repository: {
    async beginDeletion() {
      throw new AccountLifecycleError("account_owns_organization", 409);
    }
  } });
  await assert.rejects(
    () => instance.service.setStatus(principal, identity, deletion),
    (error) => error.code === "account_owns_organization" && error.status === 409
  );
  assert.equal(instance.calls.some((item) => item[0] === "identity"), false);
});

test("does not claim pending deletion when identity disable itself is unconfirmed", async () => {
  const instance = harness({ identityAdminClient: {
    async setAccountStatus() {
      throw new AccountLifecycleError("identity_session_revocation_unconfirmed", 503);
    }
  } });
  await assert.rejects(
    () => instance.service.setStatus(principal, identity, deletion),
    (error) => error.code === "identity_session_revocation_unconfirmed"
  );
});

test("resumes after Liteasy cleanup without disabling or purging twice", async () => {
  const instance = harness({ repository: {
    async beginDeletion() {
      return {
        lastCompletedStage: "liteasy_cleaned",
        result: { liteasy: { deletedEntries: 7 } },
        state: "failed"
      };
    }
  } });
  const result = await instance.service.setStatus(principal, identity, deletion);
  assert.equal(result.account.status, "deleted");
  assert.equal(instance.calls.some((item) => item[0] === "purgeLiteasyData"), false);
  assert.deepEqual(instance.calls.filter((item) => item[0] === "identity").map((item) => item[1]), [
    "deleted"
  ]);
  assert.equal(instance.calls.some((item) => item[0] === "intuecho"), true);
});

test("resumes after confirmed identity deletion without calling external services again", async () => {
  const instance = harness({ repository: {
    async beginDeletion() {
      return {
        lastCompletedStage: "identity_deleted",
        result: {
          identityDeletionReceipt: deletionReceipt,
          identityDeletedAt: "2026-08-07T00:00:00.000Z",
          intuecho: { deletedDrafts: 1 },
          liteasy: { deletedEntries: 7 }
        },
        state: "failed"
      };
    }
  } });
  const result = await instance.service.setStatus(principal, identity, deletion);
  assert.equal(result.account.status, "deleted");
  assert.deepEqual(result.sessionRevocation.audiences, deletionReceipt.revokedAudiences);
  assert.equal(instance.calls.some((item) => item[0] === "identity"), false);
  assert.equal(instance.calls.some((item) => item[0] === "intuecho"), false);
  assert.equal(instance.calls.some((item) => item[0] === "purgeLiteasyData"), false);
  assert.deepEqual(instance.calls.filter((item) => item[0] === "projectStatus").map((item) => item[1]), [
    "deleted"
  ]);
});

for (const stage of ["identity_deleted", "completed"]) {
  test(`reconfirms legacy ${stage} receipts instead of inferring revocation from a timestamp`, async () => {
    const instance = harness({ repository: {
      async beginDeletion() {
        return { lastCompletedStage: stage, state: stage, result: { identityDeletedAt: deletionReceipt.updatedAt } };
      }
    } });
    const result = await instance.service.setStatus(principal, identity, deletion);
    assert.deepEqual(instance.calls.filter((call) => call[0] === "identity"), [["identity", "deleted"]]);
    assert.deepEqual(result.sessionRevocation, { allSessionsRevoked: true, audiences: deletionReceipt.revokedAudiences });
    assert.equal(instance.calls.some((call) => ["intuecho", "purgeLiteasyData"].includes(call[0])), false);
    const receiptStage = instance.calls.find((call) => call[0] === "stage" && call[2]?.identityDeletionReceipt);
    assert.deepEqual(receiptStage?.[2].identityDeletionReceipt, deletionReceipt);
    assert.equal(receiptStage?.[1], stage);
  });

  test(`keeps ${stage} with missing revocation evidence unconfirmed if the adapter is unavailable`, async () => {
    const instance = harness({
      repository: { async beginDeletion() {
        return { lastCompletedStage: stage, state: stage, result: { identityDeletedAt: deletionReceipt.updatedAt } };
      } },
      identityAdminClient: { async setAccountStatus() {
        throw new AccountLifecycleError("identity_management_unavailable", 503);
      } }
    });
    await assert.rejects(() => instance.service.setStatus(principal, identity, deletion), (error) => error.code === "account_lifecycle_pending_retry" && error.status === 503);
    assert.equal(instance.calls.some((call) => call[0] === "completeOperation" || call[0] === "projectStatus"), false);
    assert.deepEqual(instance.calls.find((call) => call[0] === "failOperation"), ["failOperation", "identity_management_unavailable"]);
  });
}

test("replays a completed deletion using its persisted four-audience receipt", async () => {
  const job = { lastCompletedStage: "completed", state: "completed", result: { identityDeletionReceipt: deletionReceipt } };
  const instance = harness({ repository: { async beginDeletion() { return job; } } });
  const result = await instance.service.setStatus(principal, identity, deletion);
  assert.deepEqual(result.sessionRevocation, { allSessionsRevoked: true, audiences: deletionReceipt.revokedAudiences });
  assert.equal(instance.calls.some((call) => call[0] === "identity"), false);
});

test("does not replay the old operation response that omitted the mobile audience", async () => {
  const legacy = {
    account: { status: "deleted", subjectId: deletion.subjectId },
    sessionRevocation: { allSessionsRevoked: true, audiences: deletionReceipt.revokedAudiences.slice(0, 3) }
  };
  const instance = harness({ repository: {
    async beginOperation() { return { replayed: true, response: legacy }; },
    async beginDeletion() { return { lastCompletedStage: "completed", state: "completed", result: {} }; }
  } });
  const result = await instance.service.setStatus(principal, identity, deletion);
  assert.deepEqual(result.sessionRevocation.audiences, deletionReceipt.revokedAudiences);
  assert.deepEqual(instance.calls.filter((call) => call[0] === "identity"), [["identity", "deleted"]]);
});

for (const invalid of [
  { ...deletionReceipt, revokedAudiences: deletionReceipt.revokedAudiences.slice(0, 3) },
  { ...deletionReceipt, subjectId: "other_user" },
  { ...deletionReceipt, status: "disabled" },
  { ...deletionReceipt, allSessionsRevoked: false }
]) {
  test(`reconfirms invalid persisted receipt: ${JSON.stringify(invalid)}`, async () => {
    const instance = harness({ repository: { async beginDeletion() {
      return { lastCompletedStage: "completed", state: "completed", result: { identityDeletionReceipt: invalid } };
    } } });
    const result = await instance.service.setStatus(principal, identity, deletion);
    assert.deepEqual(result.sessionRevocation.audiences, deletionReceipt.revokedAudiences);
    assert.deepEqual(instance.calls.filter((call) => call[0] === "identity"), [["identity", "deleted"]]);
  });
}
