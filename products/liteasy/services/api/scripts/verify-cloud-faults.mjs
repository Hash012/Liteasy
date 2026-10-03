import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import pg from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { validateCloudFaultConfig } from "./cloudFaultGuard.mjs";
import { migratePostgres } from "../src/migrations.mjs";
import { PostgresLibraryRepository } from "../src/libraryRepository.mjs";
import { S3ObjectStore } from "../src/s3ObjectStore.mjs";
import { HttpsPdfSecurityScanner } from "../src/pdfSecurityScanner.mjs";
import { PdfUploadService } from "../src/pdfUploadService.mjs";

const phases = ["scanner-unavailable", "prepare-response-lost", "object-publication-failed", "database-completion-failed", "kill-after-prepare", "kill-after-publish"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = (id) => Buffer.from(`%PDF-1.4\n% Synthetic isolated recovery fixture ${id}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
let pool;
let migration;
let client;
try {
  assert.equal(process.argv[2], "--config", "explicit private config required");
  const configPath = fs.realpathSync(process.argv[3]);
  assert.equal(fs.statSync(configPath).mode & 0o077, 0);
  const config = validateCloudFaultConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const phase = process.argv[4];
  assert.ok(phase === undefined || phases.includes(phase));
  pool = new pg.Pool({ ...config.database.application, max: 4, ssl: false });
  migration = new pg.Pool({ ...config.database.migration, max: 1, ssl: false });
  const marker = (await migration.query("SELECT obj_description('public'::regnamespace, 'pg_namespace') AS marker")).rows[0]?.marker;
  assert.equal(marker, `liteasy-isolated-cloud-fault:v1:${config.runId}`);
  client = new S3Client({ endpoint: config.s3.endpoint, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey } });
  const markerObject = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: `${config.s3.prefix}/.isolated-test.json` }));
  assert.deepEqual(JSON.parse(await markerObject.Body.transformToString()), { schema: "liteasy.isolated-cloud-fault/v1", runId: config.runId });
  const store = new S3ObjectStore(config.s3, { client });
  const scanner = new HttpsPdfSecurityScanner({ ...config.scanner, timeoutMs: 10_000 });
  const repository = new PostgresLibraryRepository(pool);
  if (!phase) {
    await migratePostgres(migration, { applicationRole: config.database.application.user });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM library_entries")).rows[0].count, 0, "use a fresh marked database for each run");
    const cases = [];
    for (const current of phases) {
      const subject = `synthetic-${config.runId}-${current}`;
      await pool.query("INSERT INTO storage_quotas(scope_type,scope_id,limit_bytes) VALUES ('user',$1,1048576)", [subject]);
      const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--config", configPath, current], { stdio: "ignore", timeout: 60_000 });
      assert.equal(current.startsWith("kill-") ? worker.signal : worker.status, current.startsWith("kill-") ? "SIGKILL" : 0);
      const workflows = await pool.query("SELECT * FROM storage_publish_workflows WHERE actor_id=$1", [subject]);
      if (current === "scanner-unavailable") {
        assert.equal(workflows.rows.length, 0);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM library_entries WHERE scope_id=$1", [subject])).rows[0].count, 0);
        await assert.rejects(() => store.openObject(store.stagingKey(subject)));
      }
      else {
        assert.equal(workflows.rows.length, 1);
        const workflow = workflows.rows[0];
        assert.equal(workflow.security_scanner, config.scanner.expectedScanner, "real configured scanner proof required");
        assert.equal(workflow.security_scan_hash, digest(fixture(subject)));
        if (["prepare-response-lost", "object-publication-failed", "kill-after-prepare"].includes(current)) {
          const staged = await store.openObject(workflow.staging_key);
          const chunks = [];
          for await (const chunk of staged.body) chunks.push(Buffer.from(chunk));
          assert.equal(digest(Buffer.concat(chunks)), workflow.content_hash, "repair staging survives pre-publication failure");
        }
        const repaired = await new PdfUploadService(repository, store, scanner).repairPendingWorkflows();
        assert.ok(repaired.repaired >= 1);
        const entry = (await pool.query("SELECT availability FROM library_entries WHERE document_id=$1", [workflow.document_id])).rows[0];
        assert.equal(entry.availability, "available");
        const object = await store.openObject(workflow.final_key);
        const chunks = [];
        for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
        assert.equal(digest(Buffer.concat(chunks)), workflow.content_hash);
      }
      cases.push({ phase: current, status: "pass" });
    }
    console.log(JSON.stringify({ verified: true, layer: "isolated-real-PG-S3-scanner", cases, notRun: ["real-IdP-refresh", "target-cloud-provider", "native-local-originals"] }));
  } else {
    const subject = `synthetic-${config.runId}-${phase}`;
    const scope = { scopeType: "user", scopeId: subject };
    const bytes = fixture(subject);
    const prepare = repository.preparePdfUpload.bind(repository);
    if (["prepare-response-lost", "kill-after-prepare"].includes(phase)) repository.preparePdfUpload = async (...args) => {
      await prepare(...args);
      if (phase.startsWith("kill-")) process.kill(process.pid, "SIGKILL");
      throw new Error("synthetic-prepare-response-loss");
    };
    if (phase === "object-publication-failed") store.publishStagedPdf = async () => { throw new Error("synthetic-object-publication-failure"); };
    if (phase === "database-completion-failed") repository.completePdfUpload = async () => { throw new Error("synthetic-database-completion-failure"); };
    if (phase === "kill-after-publish") {
      const mark = repository.markPdfObjectPublished.bind(repository);
      repository.markPdfObjectPublished = async (...args) => { await mark(...args); process.kill(process.pid, "SIGKILL"); };
    }
    // Unavailable scanner dependency; success phases use the actual process and
    // its hash-bound response. No mocked clean verdict is used.
    const actualScanner = phase === "scanner-unavailable" ? undefined : scanner;
    await assert.rejects(() => new PdfUploadService(repository, store, actualScanner).upload(scope, {
      actorId: subject, expectedRevision: 0, fileName: "Synthetic.pdf", idempotencyKey: subject,
      operationId: subject, traceId: "isolated-cloud-fault", readable: Readable.from([bytes])
    }));
    assert.equal(digest(bytes), digest(fixture(subject)), "source bytes are unchanged");
  }
} catch {
  // Raw provider/database errors can contain credentials or private rows.
  console.error(JSON.stringify({ verified: false, errorCode: "isolated_cloud_fault_not_verified" }));
  process.exitCode = 1;
} finally {
  await pool?.end();
  await migration?.end();
  client?.destroy();
}
