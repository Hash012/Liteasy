import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getAuditArchiveDir, getDatabasePath } from "../db/dataPaths.mjs";
import { assertDevCloudDeploymentBoundary } from "../deploymentBoundary.mjs";

assertDevCloudDeploymentBoundary();
const archiveDirectory = getAuditArchiveDir();

function archiveFiles() {
  if (!fs.existsSync(archiveDirectory)) return [];
  return fs.readdirSync(archiveDirectory)
    .filter((name) => /^audit-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12}\.json$/.test(name))
    .sort();
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function verifyArchives() {
  let previousArchiveHash = null;
  for (const name of archiveFiles()) {
    const envelope = JSON.parse(fs.readFileSync(path.join(archiveDirectory, name), "utf8"));
    const { archiveHash, ...payload } = envelope;
    if (archiveHash !== digest(payload) || payload.previousArchiveHash !== previousArchiveHash) {
      throw new Error(`Audit archive chain verification failed at ${name}.`);
    }
    previousArchiveHash = archiveHash;
  }
  return { archiveCount: archiveFiles().length, latestArchiveHash: previousArchiveHash, verified: true };
}

if (process.argv.includes("--verify")) {
  process.stdout.write(`${JSON.stringify(verifyArchives())}\n`);
} else {
  fs.mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(archiveDirectory, 0o700);
  const verification = verifyArchives();
  const database = new Database(getDatabasePath(), { fileMustExist: true, readonly: true });
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      organizationEvents: database.prepare(`
        SELECT event_id, organization_id, actor_key, action, description,
          risk, metadata_json, created_at
        FROM organization_audit_events ORDER BY created_at, event_id
      `).all(),
      platformEvents: database.prepare(`
        SELECT event_id, actor_user_id, action, target_type, target_id,
          risk, reason, metadata_json, occurred_at
        FROM platform_audit_events ORDER BY occurred_at, event_id
      `).all(),
      previousArchiveHash: verification.latestArchiveHash,
      version: "liteasy.audit-archive/v1"
    };
    const archiveHash = digest(payload);
    const fileName = `audit-${payload.exportedAt.replace(/[-:]/g, "")}-${archiveHash.slice(0, 12)}.json`;
    const destination = path.join(archiveDirectory, fileName);
    const descriptor = fs.openSync(destination, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify({ ...payload, archiveHash })}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    process.stdout.write(`${JSON.stringify({ archiveHash, destination })}\n`);
  } finally {
    database.close();
  }
}
