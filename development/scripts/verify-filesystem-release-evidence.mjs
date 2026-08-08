import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "liteasy.filesystem-release-evidence/v1";
const requiredAudiences = ["intuecho-web", "liteasy-admin", "liteasy-desktop"];
const requiredWindowsCases = [
  "accountSwitchSameLocalRoot",
  "caseConflict",
  "crossRegionCopies",
  "expansionState",
  "externalCreateModifyRenameDelete",
  "fileLockRecovery",
  "junctionEscapeRejected",
  "logoutLocalAvailable",
  "narrowViewport",
  "watcherOverflowRecovery"
];

function requireValue(condition, message) {
  if (!condition) throw new Error(`filesystem_release_evidence: ${message}`);
}

function requireApproval(value, label) {
  requireValue(typeof value?.approvedBy === "string" && value.approvedBy.trim(), `${label}.approvedBy is required`);
  requireValue(!Number.isNaN(Date.parse(value?.approvedAt)), `${label}.approvedAt must be an ISO timestamp`);
}

function sha256(filePath) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function verifyEvidenceFile(record, root, label) {
  requireValue(record && typeof record === "object", `${label} evidence is required`);
  requireValue(typeof record.path === "string" && record.path.trim(), `${label}.path is required`);
  requireValue(!path.isAbsolute(record.path), `${label}.path must be relative`);
  const resolved = path.resolve(root, record.path);
  requireValue(resolved.startsWith(`${root}${path.sep}`), `${label}.path escapes the evidence directory`);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  requireValue(stat?.isFile() && !stat.isSymbolicLink(), `${label}.path must be a regular non-symlink file`);
  requireValue(/^[a-f0-9]{64}$/.test(record.sha256 ?? ""), `${label}.sha256 is invalid`);
  requireValue(sha256(resolved) === record.sha256, `${label}.sha256 does not match the evidence file`);
  return resolved;
}

function verifyDatabase(record, evidenceRoot, label, requireIsolation = false) {
  requireValue(record?.adapter === "postgresql", `${label}.adapter must be postgresql`);
  for (const capability of ["adapterIntegration", "encryptionAtRest", "pointInTimeRecovery", "tls"]) {
    requireValue(record?.[capability] === "verified", `${label}.${capability} must be verified`);
  }
  if (requireIsolation) {
    requireValue(record?.isolatedCredentials === "verified", `${label}.isolatedCredentials must be verified`);
  }
  verifyEvidenceFile(record.restoreEvidence, evidenceRoot, `${label}.restoreEvidence`);
}

export function verifyFilesystemReleaseEvidence(manifestPath) {
  const resolvedManifest = path.resolve(manifestPath ?? "");
  requireValue(fs.statSync(resolvedManifest, { throwIfNoEntry: false })?.isFile(), "manifest file does not exist");
  const manifest = JSON.parse(fs.readFileSync(resolvedManifest, "utf8"));
  const evidenceRoot = path.dirname(resolvedManifest);

  requireValue(manifest.schemaVersion === schemaVersion, `schemaVersion must be ${schemaVersion}`);
  requireValue(/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.release?.version ?? ""), "release.version is invalid");
  requireValue(/^[a-f0-9]{40}$/.test(manifest.release?.commitSha ?? ""), "release.commitSha must be a full Git SHA");
  requireApproval(manifest.release, "release");

  const windows = manifest.windowsTauri;
  requireValue(windows?.status === "passed", "windowsTauri.status must be passed");
  requireValue(Array.isArray(windows.osVersions) && windows.osVersions.length > 0, "windowsTauri.osVersions is required");
  for (const testCase of requiredWindowsCases) {
    requireValue(windows.cases?.[testCase] === "passed", `windowsTauri.cases.${testCase} must be passed`);
  }
  verifyEvidenceFile(windows.evidence, evidenceRoot, "windowsTauri.evidence");

  const database = manifest.transactionDatabase;
  verifyDatabase(database, evidenceRoot, "transactionDatabase");
  verifyDatabase(manifest.forumDatabase, evidenceRoot, "forumDatabase", true);

  const objects = manifest.objectStorage;
  requireValue(objects?.api === "s3", "objectStorage.api must be s3");
  for (const capability of [
    "adapterIntegration",
    "crossFaultDomainReplication",
    "encryptionAtRest",
    "privateAccess",
    "versioningOrImmutability"
  ]) {
    requireValue(objects?.[capability] === "verified", `objectStorage.${capability} must be verified`);
  }
  verifyEvidenceFile(objects.integrityEvidence, evidenceRoot, "objectStorage.integrityEvidence");

  const identity = manifest.identity;
  requireValue(/^https:\/\//.test(identity?.issuer ?? ""), "identity.issuer must use https");
  requireValue(
    JSON.stringify([...(identity?.audiences ?? [])].sort()) === JSON.stringify(requiredAudiences),
    "identity.audiences must contain exactly the three product audiences"
  );
  for (const capability of ["mfa", "sessionRevocation", "supportGrantExpiry"]) {
    requireValue(identity?.[capability] === "verified", `identity.${capability} must be verified`);
  }
  verifyEvidenceFile(identity.evidence, evidenceRoot, "identity.evidence");

  const levels = manifest.serviceLevels;
  for (const field of ["accountDeletionRetentionDays", "auditRetentionDays", "rpoMinutes", "rtoMinutes"]) {
    requireValue(Number.isFinite(levels?.[field]) && levels[field] >= 0, `serviceLevels.${field} must be approved`);
  }
  requireValue(levels.rpoMinutes > 0 && levels.rtoMinutes > 0, "serviceLevels RPO and RTO must be positive");
  requireApproval(levels, "serviceLevels");
  verifyEvidenceFile(levels.approvalEvidence, evidenceRoot, "serviceLevels.approvalEvidence");

  return {
    commitSha: manifest.release.commitSha,
    schemaVersion,
    verified: true,
    version: manifest.release.version
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(verifyFilesystemReleaseEvidence(process.argv[2]))}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
