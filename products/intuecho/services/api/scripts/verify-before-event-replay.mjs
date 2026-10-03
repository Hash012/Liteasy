import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrateIntuecho, readIntuechoMigrations, verifyIntuechoMigrations } from "../src/migrations.mjs";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";
import { validateIntuechoRecoveryTestConfig } from "./postgresRecoveryGuard.mjs";

// See docs/qa/account-cloud-community/S14-verification-matrix.md. This creates
// two new disposable test databases and retains their restricted evidence. It
// never restores over an existing database and has no implicit target defaults.
let config;
try {
  assert.equal(process.argv.length, 4);
  assert.equal(process.argv[2], "--config");
  const configFile = fs.realpathSync(process.argv[3]);
  assert.equal(fs.statSync(configFile).mode & 0o077, 0, "configuration-must-be-private");
  config = validateIntuechoRecoveryTestConfig(JSON.parse(fs.readFileSync(configFile, "utf8")));
  config.binaryDirectory = fs.realpathSync(config.binaryDirectory);
  config.evidenceDirectory = fs.realpathSync(config.evidenceDirectory);
  if (config.libraryDirectory) config.libraryDirectory = fs.realpathSync(config.libraryDirectory);
  const checkout = fs.realpathSync(fileURLToPath(new URL("../../../../../", import.meta.url)));
  assert.ok(config.evidenceDirectory !== checkout && !config.evidenceDirectory.startsWith(checkout + path.sep), "evidence-must-stay-outside-checkout");
} catch {
  console.error(JSON.stringify({ verified: false, errorCode: "intuecho_recovery_test_configuration_forbidden" }));
  process.exit(1);
}

const suffix = randomBytes(5).toString("hex");
const directory = path.join(config.evidenceDirectory, `before-event-drill-${suffix}`);
fs.mkdirSync(directory, { mode: 0o700 });
const result = { verified: false, storage: "postgresql", boundary: "synthetic-before-event-backup-later-ledger-replay", cases: [], notRun: ["real-IdP", "S3", "production-independent-journal-backup", "production-routing-readiness"] };
const admin = new pg.Pool({ ...config.admin, max: 1, ssl: false });
const quote = (value) => { assert.match(value, /^[a-z0-9_]+$/); return `"${value}"`; };
const digest = (value) => createHash("sha256").update(value).digest("hex");
const pools = [];
const pool = (connection) => { const value = new pg.Pool({ ...connection, max: 3, ssl: false }); pools.push(value); return value; };
let step = "start";
function command(name, args, connection) {
  const output = spawnSync(path.join(config.binaryDirectory, name), args, { encoding: "utf8", env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))),
    ...(config.libraryDirectory ? { LD_LIBRARY_PATH: config.libraryDirectory } : {}),
    PGHOST: connection.host, PGHOSTADDR: connection.host, PGPORT: String(connection.port), PGDATABASE: connection.database,
    PGUSER: connection.user, PGPASSWORD: connection.password, PGSSLMODE: "disable"
  } });
  fs.writeFileSync(path.join(directory, `${name}.log`), output.stdout + output.stderr, { mode: 0o600 });
  assert.equal(output.status, 0, `${name} failed; see restricted log`);
}
async function role(name) {
  const password = randomBytes(24).toString("hex");
  await admin.query(`CREATE ROLE ${quote(name)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  return { user: name, password };
}
async function database(kind, allowBusiness) {
  const database = `account_${kind}_${suffix}_test`;
  const owner = await role(`restore_${kind}_owner_${suffix}`);
  const recovery = allowBusiness ? null : await role(`restore_${kind}_replay_${suffix}`);
  const business = await role(`restore_${kind}_app_${suffix}`);
  await admin.query(`GRANT ${quote(owner.user)} TO ${quote(config.admin.user)}`);
  await admin.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(owner.user)}`);
  await admin.query(`REVOKE CONNECT ON DATABASE ${quote(database)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(owner.user)}${recovery ? `, ${quote(recovery.user)}` : ""}${allowBusiness ? `, ${quote(business.user)}` : ""}`);
  const base = { host: config.admin.host, port: config.admin.port, database };
  return { database, owner: { ...base, ...owner }, ...(recovery ? { recovery: { ...base, ...recovery } } : {}), business: { ...base, ...business } };
}
async function denied(connection) {
  const probe = new pg.Pool({ ...connection, max: 1, ssl: false });
  try { await assert.rejects(() => probe.query("SELECT 1"), (error) => error.code === "42501"); }
  finally { await probe.end(); }
}
try {
  step = "verify-explicit-test-instance-before-any-mutation";
  const marker = (await admin.query("SELECT shobj_description(oid, 'pg_database') AS value FROM pg_database WHERE datname=current_database()" )).rows[0]?.value;
  assert.equal(marker, `liteasy-isolated-recovery-control:v1:${config.expectedSystemIdentifier}`);
  assert.equal((await admin.query("SELECT system_identifier::text AS value FROM pg_control_system()")).rows[0].value, config.expectedSystemIdentifier);
  const adminAttributes = (await admin.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(adminAttributes, { rolsuper: false, rolcreatedb: true, rolcreaterole: true, rolinherit: true });
  step = "new-isolated-databases";
  const source = await database("before_source", true);
  const restored = await database("before_restore", false);
  result.sourceDatabase = source.database;
  result.restoredDatabase = restored.database;
  fs.writeFileSync(path.join(directory, "credentials.json"), JSON.stringify({ source, restored }), { mode: 0o600 });
  const sourceOwner = pool(source.owner);
  await migrateIntuecho(sourceOwner, { applicationRole: source.business.user });
  result.sourceMigrations = (await verifyIntuechoMigrations(sourceOwner)).count;
  result.lastMigration = readIntuechoMigrations().at(-1).name;
  const sourceApp = pool(source.business);
  const subject = `deleted-before-replay-${suffix}`;
  const privateId = `private-before-replay-${suffix}`;
  const retainedId = `retained-before-replay-${suffix}`;
  const publicationOwner = { id: `withdraw-before-replay-${suffix}`, name: "Synthetic surviving owner", initials: "SW" };
  const publicationId = `publication-before-replay-${suffix}`;
  const queueKey = `queue-before-replay-${suffix}`;
  const literatureId = `literature-before-replay-${suffix}`;
  const createdAt = "2026-10-03T01:00:00.000Z";
  const deletionInput = { subjectId: subject, requestedBy: "synthetic-recovery-admin", idempotencyKey: `delete-${suffix}`, traceId: `delete-trace-${suffix}`, reason: "Synthetic account deletion after the older backup" };
  const withdrawalInput = { annotationId: "local-before-event-1", operation: "retract", queueKey, remoteAnnotationId: publicationId, revision: 2, updatedAt: "2026-10-03T02:00:00.000Z" };
  step = "seed-before-event-state";
  await sourceApp.query("INSERT INTO literature_records(id,title,authors) VALUES ($1,'Synthetic old backup source','[]'::jsonb)", [literatureId]);
  await sourceApp.query("BEGIN");
  for (const [id, author, visibility, body] of [
    [privateId, subject, "private", "Synthetic private text that must be deleted after replay"],
    [retainedId, subject, "public", "Synthetic public text retained under existing D03 rules"],
    [publicationId, publicationOwner.id, "public", "Synthetic publication that must be withdrawn after replay"]
  ]) {
    await sourceApp.query(`INSERT INTO annotations(id,body,author_id,author_name,author_initials,author_profile_snapshot,
      visibility,share_to_plaza,created_at,updated_at) VALUES ($1,$2,$3,'Synthetic Author','SA','{}'::jsonb,$4,$5,$6,$6)`,
    [id, body, author, visibility, visibility === "public", createdAt]);
    await sourceApp.query(`INSERT INTO annotation_targets(id,annotation_id,literature_id,target_kind,position,target)
      VALUES ($1,$2,$3,'whole_document',0,'{"kind":"whole_document"}'::jsonb)`, [`target-${id}`, id, literatureId]);
  }
  await sourceApp.query("COMMIT");
  await sourceApp.query(`INSERT INTO desktop_annotation_syncs(owner_id,queue_key,source_annotation_id,annotation_id,source_created_at,source_updated_at)
    VALUES ($1,$2,$3,$4,$5,$5)`, [publicationOwner.id, queueKey, withdrawalInput.annotationId, publicationId, createdAt]);
  await sourceApp.query(`INSERT INTO annotation_replies(id,parent_annotation_id,body,author_id,author_name,author_initials,author_profile_snapshot,visibility)
    VALUES ($1,$2,'Synthetic preserved reply','synthetic-other','Other','O','{}'::jsonb,'public')`, [`reply-${suffix}`, publicationId]);
  assert.equal((await sourceApp.query("SELECT count(*)::int AS count FROM account_deletion_jobs")).rows[0].count, 0);
  assert.equal((await sourceApp.query("SELECT count(*)::int AS count FROM desktop_annotation_publications WHERE state='retracted'")).rows[0].count, 0);
  step = "dump-before-any-deletion-or-withdrawal";
  const backup = path.join(directory, "before-events.dump");
  command("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", backup], source.owner);
  fs.chmodSync(backup, 0o600);
  const backupDigest = digest(fs.readFileSync(backup));
  const backupFinishedAt = (await sourceApp.query("SELECT clock_timestamp() AS value")).rows[0].value.toISOString();
  result.backupFinishedAt = backupFinishedAt;
  result.backupSha256 = backupDigest;
  step = "create-later-authoritative-events";
  const sourceDeletion = await new PostgresAccountLifecycleRepository(sourceApp).deleteAccount(deletionInput);
  assert.equal(sourceDeletion.result.deletedNonPublicAnnotations, 1);
  assert.equal(sourceDeletion.result.anonymizedAnnotations, 1);
  const [sourceWithdrawal] = await new PostgresAnnotationCommunityRepository(sourceApp).applyDesktopAnnotationPublications(publicationOwner, [withdrawalInput]);
  assert.equal(sourceWithdrawal.state, "retracted");
  const deletion = (await sourceApp.query(`SELECT j.subject_id,j.operation_id,j.requested_by,j.reason,j.completed_at,j.request_hash,a.trace_id
    FROM account_deletion_jobs j JOIN account_lifecycle_audit a ON a.operation_id=j.operation_id WHERE j.subject_id=$1`, [subject])).rows[0];
  const publication = (await sourceApp.query("SELECT * FROM desktop_annotation_publications WHERE owner_id=$1 AND queue_key=$2", [publicationOwner.id, queueKey])).rows[0];
  assert.ok(deletion.completed_at.getTime() >= Date.parse(backupFinishedAt));
  assert.equal(publication.state, "retracted");
  const journal = {
    format: "synthetic-recovery-ledger/v1", sourceDatabase: source.database, targetDatabase: restored.database,
    backupSha256: backupDigest, backupFinishedAt,
    highWatermark: (await sourceApp.query("SELECT clock_timestamp() AS value")).rows[0].value.toISOString(),
    events: [
      { kind: "delete", input: { subjectId: deletion.subject_id, idempotencyKey: deletion.operation_id, requestedBy: deletion.requested_by, reason: deletion.reason, traceId: deletion.trace_id }, requestHash: deletion.request_hash, completedAt: deletion.completed_at.toISOString() },
      { kind: "withdraw", owner: publicationOwner.id, input: { annotationId: publication.source_annotation_id, queueKey: publication.queue_key, operation: "retract", remoteAnnotationId: publication.annotation_id, revision: Number(publication.source_revision), updatedAt: publication.source_updated_at.toISOString() } }
    ]
  };
  assert.deepEqual(journal.events[0].input, deletionInput);
  assert.deepEqual(journal.events[1].input, withdrawalInput);
  const journalFile = path.join(directory, "later-events.json");
  const journalBytes = JSON.stringify(journal, null, 2);
  const journalDigest = digest(journalBytes);
  fs.writeFileSync(journalFile, journalBytes, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "recovery-manifest.json"), JSON.stringify({ backupSha256: backupDigest, journalSha256: journalDigest, expectedEvents: 2, highWatermark: journal.highWatermark }, null, 2), { mode: 0o600 });
  result.laterEvents = 2;
  result.journalSha256 = journalDigest;
  result.cases.push("backup-predates-deletion-and-withdrawal", "later-events-derived-from-source-ledgers");
  step = "restore-older-backup-with-business-connect-revoked";
  command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", restored.database, backup], restored.owner);
  const restoredOwner = pool(restored.owner);
  await migrateIntuecho(restoredOwner, { applicationRole: restored.recovery.user });
  await migrateIntuecho(restoredOwner, { applicationRole: restored.business.user });
  result.restoredMigrations = (await verifyIntuechoMigrations(restoredOwner)).count;
  assert.equal(result.restoredMigrations, result.sourceMigrations);
  const recoveryPool = pool(restored.recovery);
  const current = new PostgresAnnotationCommunityRepository(recoveryPool);
  const lifecycle = new PostgresAccountLifecycleRepository(recoveryPool);
  assert.equal((await recoveryPool.query("SELECT count(*)::int AS count FROM account_deletion_jobs WHERE subject_id=$1", [subject])).rows[0].count, 0);
  assert.equal((await recoveryPool.query("SELECT count(*)::int AS count FROM annotations WHERE id=$1", [privateId])).rows[0].count, 1);
  assert.equal((await recoveryPool.query("SELECT visibility FROM annotations WHERE id=$1", [publicationId])).rows[0].visibility, "public");
  await denied(restored.business);
  result.cases.push("older-restore-demonstrably-has-private-and-public-stale-state", "business-connect-denied-before-replay");
  async function replay(file, { failBeforeWithdrawal = false } = {}) {
    const bytes = fs.readFileSync(file, "utf8");
    assert.equal(digest(bytes), journalDigest, "untrusted-or-incomplete-journal");
    assert.equal(digest(fs.readFileSync(backup)), backupDigest, "changed-backup");
    const events = JSON.parse(bytes);
    assert.equal(events.targetDatabase, restored.database);
    assert.equal(events.sourceDatabase, source.database);
    assert.equal(events.backupSha256, backupDigest);
    assert.equal(events.highWatermark, journal.highWatermark);
    assert.equal(events.events.length, 2);
    const receipts = [];
    for (const event of events.events) {
      if (event.kind === "delete") receipts.push(await lifecycle.deleteAccount(event.input));
      else if (event.kind === "withdraw") {
        if (failBeforeWithdrawal) throw new Error("synthetic-replay-interrupted");
        const [receipt] = await current.applyDesktopAnnotationPublications({ id: event.owner, name: "Synthetic surviving owner", initials: "SW" }, [event.input]);
        assert.equal(receipt.state, "retracted");
        receipts.push(receipt);
      } else throw new Error("unsupported-journal-event");
    }
    return receipts;
  }
  step = "exercise-closed-recovery-gate";
  await assert.rejects(() => replay(path.join(directory, "missing-journal.json")), (error) => error.code === "ENOENT");
  await denied(restored.business);
  const incomplete = path.join(directory, "incomplete-events.json");
  fs.writeFileSync(incomplete, JSON.stringify({ ...journal, events: [journal.events[0]] }), { mode: 0o600 });
  await assert.rejects(() => replay(incomplete), /untrusted-or-incomplete-journal/);
  await denied(restored.business);
  await assert.rejects(() => replay(journalFile, { failBeforeWithdrawal: true }), /synthetic-replay-interrupted/);
  await denied(restored.business);
  assert.equal((await recoveryPool.query("SELECT count(*)::int AS count FROM annotations WHERE id=$1", [privateId])).rows[0].count, 0);
  assert.equal((await recoveryPool.query("SELECT visibility FROM annotations WHERE id=$1", [publicationId])).rows[0].visibility, "public");
  result.cases.push("missing-journal-keeps-gate-closed", "incomplete-journal-keeps-gate-closed", "partial-replay-keeps-gate-closed");
  step = "replay-and-verify-before-opening-business";
  const receipts = await replay(journalFile);
  assert.equal(receipts[0].replayed, true);
  const retained = (await recoveryPool.query("SELECT author_id,author_name,body,revision FROM annotations WHERE id=$1", [retainedId])).rows[0];
  assert.notEqual(retained.author_id, subject);
  assert.equal(retained.author_name, "已注销用户");
  assert.match(retained.body, /retained under existing D03/);
  const withdrawn = (await recoveryPool.query("SELECT visibility,share_to_plaza,revision FROM annotations WHERE id=$1", [publicationId])).rows[0];
  assert.equal(withdrawn.visibility, "private");
  assert.equal(withdrawn.share_to_plaza, false);
  assert.equal((await recoveryPool.query("SELECT count(*)::int AS count FROM annotation_replies WHERE id=$1", [`reply-${suffix}`])).rows[0].count, 1);
  assert.deepEqual(await replay(journalFile), receipts);
  assert.deepEqual((await recoveryPool.query("SELECT author_id,author_name,body,revision FROM annotations WHERE id=$1", [retainedId])).rows[0], retained);
  const [oldPublication] = await current.syncDesktopAnnotations(publicationOwner, [{ annotationId: withdrawalInput.annotationId, queueKey, body: "Must not resurrect", targets: [], createdAt, updatedAt: createdAt }]);
  assert.equal(oldPublication.error, "ANNOTATION_PUBLICATION_RETRACTED");
  const [deletedWrite] = await current.applyDesktopAnnotationPublications({ id: subject, name: "Deleted", initials: "D" }, [{ annotationId: "late", queueKey: `late-${suffix}`, operation: "upsert", revision: 1, updatedAt: createdAt, body: "Must not be created", literatureId, sourcePassage: { anchorHash: "late-anchor", excerpt: "Synthetic", rects: [] } }]);
  assert.equal(deletedWrite.error, "ANNOTATION_PUBLICATION_OWNER_DELETED");
  assert.deepEqual((await recoveryPool.query("SELECT visibility,share_to_plaza,revision FROM annotations WHERE id=$1", [publicationId])).rows[0], withdrawn);
  assert.equal((await recoveryPool.query("SELECT count(*)::int AS count FROM annotations WHERE author_id=$1", [subject])).rows[0].count, 0);
  result.cases.push("deletion-replay-removes-private-data", "retained-public-data-anonymized-under-D03", "withdrawal-replay-hides-publication-and-preserves-replies", "exact-repeat-is-idempotent", "old-publication-cannot-resurrect", "deleted-owner-late-write-rejected");
  await denied(restored.business);
  // This is the only business CONNECT grant for the restored DB. Every earlier
  // failure exits without granting it; the recovery identity is separate.
  await admin.query(`GRANT CONNECT ON DATABASE ${quote(restored.database)} TO ${quote(restored.business.user)}`);
  const business = pool(restored.business);
  assert.equal((await business.query("SELECT count(*)::int AS count FROM annotations WHERE id=$1", [privateId])).rows[0].count, 0);
  assert.equal((await business.query("SELECT visibility FROM annotations WHERE id=$1", [publicationId])).rows[0].visibility, "private");
  const attributes = (await business.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(attributes, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  result.cases.push("business-connect-opens-only-after-all-replay-and-verification", "restored-app-is-not-privileged");
  result.verified = true;
} catch (error) {
  result.failedStep = step;
  result.errorCode = error?.code ?? error?.name ?? "DRILL_FAILED";
  process.exitCode = 1;
} finally {
  await Promise.allSettled(pools.map((value) => value.end()));
  await admin.end();
  fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ verified: result.verified, failedStep: result.failedStep, cases: result.cases.length, evidence: path.join(directory, "result.json") }));
}
