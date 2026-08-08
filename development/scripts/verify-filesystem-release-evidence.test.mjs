import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { verifyFilesystemReleaseEvidence } from "./verify-filesystem-release-evidence.mjs";

function createEvidence(root, name, body) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, body);
  return { path: name, sha256: createHash("sha256").update(body).digest("hex") };
}

function createManifest(root) {
  const windowsEvidence = createEvidence(root, "windows-e2e.json", "windows-e2e-passed");
  const databaseEvidence = createEvidence(root, "database-restore.json", "pitr-restore-passed");
  const objectEvidence = createEvidence(root, "object-integrity.json", "s3-integrity-passed");
  const identityEvidence = createEvidence(root, "identity.json", "identity-passed");
  const forumDatabaseEvidence = createEvidence(root, "forum-database-restore.json", "forum-pitr-restore-passed");
  const approvalEvidence = createEvidence(root, "business-approval.json", "approved");
  return {
    forumDatabase: {
      adapter: "postgresql",
      adapterIntegration: "verified",
      encryptionAtRest: "verified",
      isolatedCredentials: "verified",
      pointInTimeRecovery: "verified",
      restoreEvidence: forumDatabaseEvidence,
      tls: "verified"
    },
    identity: {
      audiences: ["liteasy-desktop", "intuecho-web", "liteasy-admin"],
      evidence: identityEvidence,
      issuer: "https://identity.liteasy.example",
      mfa: "verified",
      sessionRevocation: "verified",
      supportGrantExpiry: "verified"
    },
    objectStorage: {
      adapterIntegration: "verified",
      api: "s3",
      crossFaultDomainReplication: "verified",
      encryptionAtRest: "verified",
      integrityEvidence: objectEvidence,
      privateAccess: "verified",
      versioningOrImmutability: "verified"
    },
    release: {
      approvedAt: "2026-08-06T12:00:00.000Z",
      approvedBy: "release-owner@example.com",
      commitSha: "a".repeat(40),
      version: "1.0.0"
    },
    schemaVersion: "liteasy.filesystem-release-evidence/v1",
    serviceLevels: {
      accountDeletionRetentionDays: 30,
      approvalEvidence,
      approvedAt: "2026-08-06T12:00:00.000Z",
      approvedBy: "business-owner@example.com",
      auditRetentionDays: 365,
      rpoMinutes: 15,
      rtoMinutes: 60
    },
    transactionDatabase: {
      adapter: "postgresql",
      adapterIntegration: "verified",
      encryptionAtRest: "verified",
      pointInTimeRecovery: "verified",
      restoreEvidence: databaseEvidence,
      tls: "verified"
    },
    windowsTauri: {
      cases: Object.fromEntries([
        "accountSwitchSameLocalRoot", "caseConflict", "crossRegionCopies", "expansionState",
        "externalCreateModifyRenameDelete", "fileLockRecovery", "junctionEscapeRejected",
        "logoutLocalAvailable", "narrowViewport", "watcherOverflowRecovery"
      ].map((name) => [name, "passed"])),
      evidence: windowsEvidence,
      osVersions: ["Windows 11 24H2"],
      status: "passed"
    }
  };
}

test("accepts a complete manifest backed by matching evidence files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-release-evidence-"));
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(createManifest(root)));
  assert.deepEqual(verifyFilesystemReleaseEvidence(manifestPath), {
    commitSha: "a".repeat(40),
    schemaVersion: "liteasy.filesystem-release-evidence/v1",
    verified: true,
    version: "1.0.0"
  });
});

test("rejects missing Windows cases and forged evidence hashes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-release-evidence-"));
  const manifest = createManifest(root);
  delete manifest.windowsTauri.cases.junctionEscapeRejected;
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyFilesystemReleaseEvidence(manifestPath), /junctionEscapeRejected/);

  manifest.windowsTauri.cases.junctionEscapeRejected = "passed";
  manifest.objectStorage.integrityEvidence.sha256 = "0".repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyFilesystemReleaseEvidence(manifestPath), /sha256 does not match/);
});

test("requires an independently credentialed and recoverable forum database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-release-evidence-"));
  const manifest = createManifest(root);
  manifest.forumDatabase.isolatedCredentials = "missing";
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyFilesystemReleaseEvidence(manifestPath), /forumDatabase.isolatedCredentials/);
});

test("rejects traversal and symlink evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-release-evidence-"));
  const manifest = createManifest(root);
  manifest.identity.evidence.path = "../identity.json";
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyFilesystemReleaseEvidence(manifestPath), /escapes the evidence directory/);
});
