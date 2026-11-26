import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { migratePostgres, verifyPostgresMigrations } from "../migrations.mjs";
import { createCloudRequestHandler } from "../server.mjs";
import { IdentityError } from "../identityVerifier.mjs";
import { PostgresAccountLifecycleRepository } from "../accountLifecycleRepository.mjs";
import { ContextClient } from "../../../../packages/context-client/src/index.mjs";
import { PostgresContextEntryRepository } from "./contextEntryRepository.mjs";
import { ContextEntryService } from "./contextEntryService.mjs";
import { ContextGrantRepository } from "./contextGrantRepository.mjs";

const connectionString = process.env.LITEASY_CONTEXT_TEST_DATABASE_URL;
const createInput = (overrides = {}) => ({ schemaVersion: "liteasy.context-write/v1", operationId: randomUUID(), action: "create", entry: {
  scopeKey: "personal", kind: "understanding", title: "GPU 压缩与向量数据库", bodyMarkdown: "【合成测试】我的理解仍有待确认。\n条件：只适用于连续访问。",
  basis: "agent_summary", ...overrides
} });
test("Context HTTP + PostgreSQL: privacy, CAS, receipts, grants and account lifecycle", { skip: !connectionString }, async (t) => {
  const schema = `context_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString, ssl: false });
  let pool; let server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString, ssl: false, max: 10, options: `-c search_path=${schema}` });
    await migratePostgres(pool);
    assert.equal((await verifyPostgresMigrations(pool)).current, true);
    const entries = new PostgresContextEntryRepository(pool);
    const service = new ContextEntryService(entries);
    const grants = new ContextGrantRepository(entries);
    const identityVerifier = { async verifyAuthorizationHeader(header, audience, clientId) {
      const match = /^Bearer (desktop|mobile)-(alice|bob)$/.exec(header ?? "");
      if (!match || audience !== `liteasy-${match[1]}`) throw new IdentityError("access_token_invalid");
      assert.equal(clientId, `${match[1]}-client`);
      return { subject: match[2], audience };
    } };
    let loseWriteResponse = false; let loseReceiptResponse = false;
    const handler = createCloudRequestHandler({ contextEntryService: service, contextGrantRepository: grants, identityVerifier }, {
      allowedOrigins: [], identity: { desktopClientId: "desktop-client", mobileClientId: "mobile-client" }
    });
    server = http.createServer((request, response) => {
      if (loseWriteResponse && request.method === "POST" && request.url === "/v1/context/entries") {
        loseWriteResponse = false; response.end = () => request.socket.destroy();
      }
      if (loseReceiptResponse && request.url.startsWith("/v1/context/operations/")) {
        loseReceiptResponse = false; response.writeHead(503, { "content-type": "application/json" }); response.end(JSON.stringify({ schemaVersion: "liteasy.context-api/v1", error: { code: "context_service_unavailable", retryable: true } })); return;
      }
      void handler(request, response);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const alice = new ContextClient({ origin, token: "desktop-alice" });
    const bob = new ContextClient({ origin, token: "desktop-bob" });
    let input; let saved;
    await t.test("commits once across credential rotation and exposes no secret hashes", async () => {
      input = createInput(); saved = await alice.write(input);
      const grantInput = { name: "Linux Agent", readScopes: ["personal"], writeScopes: ["personal"], expiresAt: new Date(Date.now() + 86400_000).toISOString() };
      const first = await alice.createGrant(grantInput);
      const second = await alice.createGrant(grantInput);
      const one = new ContextClient({ origin, token: first.secret });
      const two = new ContextClient({ origin, token: second.secret });
      assert.deepEqual(await one.write(input), saved);
      assert.deepEqual(await two.write(input), saved);
      assert.equal((await two.get(saved.entryId)).entry.bodyMarkdown, input.entry.bodyMarkdown);
      assert.equal((await two.whoami()).idempotencyWindowSeconds, 604800);
      const listing = JSON.stringify(await alice.grants());
      assert.equal(listing.includes(first.secret), false);
      assert.equal(listing.includes("secret_hash"), false);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM context_entries")).rows[0].count, 1);
      await assert.rejects(one.createGrant(grantInput), { status: 403 });
      await assert.rejects(one.request("GET", "/v1/account/capabilities"), { code: "context_path_invalid" });
      const foreign = await fetch(`${origin}/v1/agent-artifacts`, { headers: { authorization: `Bearer ${first.secret}` } });
      assert.equal(foreign.status, 401);
      await alice.revokeGrant(first.grant.id);
      for (const action of [() => one.get(saved.entryId), () => one.write(input), () => one.operation(input.operationId), () => one.whoami()]) {
        await assert.rejects(action(), { status: 401 });
      }
      await pool.query("UPDATE context_grants SET expires_at=now()-interval '1 second' WHERE grant_id=$1", [second.grant.id]);
      await assert.rejects(two.whoami(), { status: 401 });
    });
    await t.test("owner isolation, strict inputs, and current scope for replay/receipts", async () => {
      await assert.rejects(bob.get(saved.entryId), { status: 404 });
      await assert.rejects(bob.operation(input.operationId), { status: 404 });
      assert.equal((await bob.list()).entries.length, 0);
      await assert.rejects(alice.write({ ...createInput(), owner: "bob" }), { status: 400 });
      await assert.rejects(alice.write({ ...input, entry: { ...input.entry, title: "different" } }), { code: "context_operation_conflict", status: 409 });
      const narrow = await alice.createGrant({ name: "one project", readScopes: ["project/test"], writeScopes: ["project/test"], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
      const client = new ContextClient({ origin, token: narrow.secret });
      await assert.rejects(client.get(saved.entryId), { status: 403 });
      await assert.rejects(client.operation(input.operationId), { status: 403 });
      await assert.rejects(client.write(input), { status: 403 });
      assert.equal((await client.list()).entries.length, 0);
      const readOnly = await alice.createGrant({ name: "reader", readScopes: ["personal"], writeScopes: [], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
      await assert.rejects(new ContextClient({ origin, token: readOnly.secret }).operation(input.operationId), { status: 403 });
    });
    await t.test("concurrent revision writers cannot silently overwrite and retain history", async () => {
      const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => alice.write({
        schemaVersion: input.schemaVersion, operationId: randomUUID(), action: "update", entryId: saved.entryId,
        expectedRevision: 1, entry: { ...input.entry, bodyMarkdown: `修正 ${index}；限制条件保留。` }
      })));
      assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
      for (const outcome of outcomes.filter((value) => value.status === "rejected")) {
        assert.equal(outcome.reason.code, "context_revision_conflict"); assert.equal(outcome.reason.currentRevision, 2);
      }
      const history = await alice.history(saved.entryId, { limit: 1 });
      assert.equal(history.revisions[0].revision, 2);
      assert.equal((await alice.history(saved.entryId, { limit: 1, cursor: history.nextCursor })).revisions[0].bodyMarkdown, input.entry.bodyMarkdown);
      await assert.rejects(alice.write({ ...input, action: "update", operationId: randomUUID(), entryId: saved.entryId, expectedRevision: 2,
        entry: { ...input.entry, scopeKey: "project/move" } }), { code: "context_scope_immutable" });
    });
    await t.test("Chinese matching, pagination and archive use authoritative revisions", async () => {
      await alice.write(createInput({ title: "第二条 GPU 压缩", kind: "idea" }));
      const first = await alice.list({ query: "GPU 压缩", limit: 1 });
      assert.equal(first.entries.length, 1); assert.ok(first.nextCursor);
      assert.equal((await alice.list({ query: "GPU 压缩", limit: 1, cursor: first.nextCursor })).entries.length, 1);
      await assert.rejects(alice.list({ query: "changed", cursor: first.nextCursor }), { code: "context_cursor_invalid" });
      const current = (await alice.get(saved.entryId)).entry;
      const { schemaVersion, id, revision, owner, actor, createdAt, updatedAt, ...content } = current;
      await alice.write({ schemaVersion: input.schemaVersion, operationId: randomUUID(), action: "update", entryId: id, expectedRevision: revision, entry: { ...content, status: "archived" } });
      assert.equal((await alice.list({ status: "archived" })).entries[0].id, id);
      assert.equal((await alice.get(id)).entry.revision, 3);
    });
    await t.test("delete removes all readable content and replay cannot resurrect it", async () => {
      const deleted = await alice.write({ schemaVersion: input.schemaVersion, operationId: randomUUID(), action: "delete", entryId: saved.entryId, expectedRevision: 3 });
      assert.equal(deleted.revision, 4);
      assert.deepEqual(await alice.write(input), saved);
      await assert.rejects(alice.get(saved.entryId), { status: 404 });
      await assert.rejects(alice.history(saved.entryId), { status: 404 });
      const row = (await pool.query("SELECT content FROM context_entries WHERE entry_id=$1", [saved.entryId])).rows[0];
      assert.equal(row.content, null);
      assert.equal((await pool.query("SELECT * FROM context_revisions WHERE entry_id=$1", [saved.entryId])).rows.length, 0);
      assert.equal(JSON.stringify(await alice.operation(input.operationId)).includes("bodyMarkdown"), false);
    });
    await t.test("whole-entry budgets count Unicode points and unauthorized scopes stay excluded", async () => {
      const write = await alice.write(createInput({ title: "中文🧪", bodyMarkdown: "条件不能裁掉🧪", kind: "profile" }));
      const found = await alice.query({ schemaVersion: "liteasy.context-api/v1", query: "中文", maxChars: 1 });
      assert.equal(found.selectedEntries.length, 0); assert.equal(found.omitted[0].id, write.entryId);
      const length = Array.from("中文🧪条件不能裁掉🧪").length;
      const fit = await alice.query({ schemaVersion: "liteasy.context-api/v1", query: "中文", maxChars: length });
      assert.equal(fit.budget.usedChars, length); assert.equal(fit.selectedEntries[0].bodyMarkdown, "条件不能裁掉🧪");
      assert.equal((await bob.query({ schemaVersion: "liteasy.context-api/v1", maxChars: 12000 })).selectedEntries.length, 0);
    });
    await t.test("pagination retains PostgreSQL microseconds and write failures roll back all records", async () => {
      const receipts = [];
      for (let index = 0; index < 3; index++) receipts.push(await alice.write(createInput({ title: `microcursor ${index}` })));
      for (let index = 0; index < 3; index++) await pool.query("UPDATE context_entries SET updated_at=$2::timestamptz WHERE entry_id=$1", [receipts[index].entryId, `2026-11-26T00:00:00.123${index}00Z`]);
      let cursor; const ids = [];
      do { const page = await alice.list({ query: "microcursor", limit: 1, ...(cursor ? { cursor } : {}) }); ids.push(...page.entries.map((entry) => entry.id)); cursor = page.nextCursor; } while (cursor);
      assert.equal(new Set(ids).size, 3);
      await pool.query("CREATE FUNCTION reject_context_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.content->>'title'='force rollback' THEN RAISE EXCEPTION 'synthetic rejection'; END IF; RETURN NEW; END $$");
      await pool.query("CREATE TRIGGER context_revision_test_failure BEFORE INSERT ON context_revisions FOR EACH ROW EXECUTE FUNCTION reject_context_revision()");
      const attempt = createInput({ title: "force rollback" });
      await assert.rejects(alice.write(attempt), { status: 503 });
      assert.equal((await pool.query("SELECT * FROM context_entries WHERE content->>'title'='force rollback'")).rows.length, 0);
      await assert.rejects(alice.operation(attempt.operationId), { status: 404 });
      await pool.query("DROP TRIGGER context_revision_test_failure ON context_revisions");
    });
    await t.test("mobile audience submits to the same service with a narrow route surface", async () => {
      const write = createInput({ kind: "idea", basis: "user_authored", status: "draft" });
      const send = (token, body) => fetch(`${origin}/v1/mobile/context/submit`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await send("mobile-alice", write); assert.equal(result.status, 200);
      const receipt = await result.json(); assert.equal((await alice.get(receipt.entryId)).entry.kind, "idea");
      assert.equal((await send("desktop-alice", createInput({ kind: "idea", basis: "user_authored" }))).status, 401);
      assert.equal((await send("mobile-alice", createInput())).status, 403);
      const grant = await alice.createGrant({ name: "not mobile", readScopes: ["personal"], writeScopes: ["personal"], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
      assert.equal((await send(grant.secret, write)).status, 401);
    });
    await t.test("CLI handles BOM/Chinese paths, CAS and an uncertain write using the original receipt", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "liteasy CLI 中文 "));
      const main = fileURLToPath(new URL("../../../../apps/cli/dist/main.mjs", import.meta.url));
      const cli = (args, stdin = "") => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [main, ...args, "--json"], { env: { ...process.env, LITEASY_CONFIG_DIR: path.join(directory, "config") }, shell: false, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = ""; let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject); child.on("close", (code) => resolve({ code, stdout, stderr })); child.stdin.end(stdin);
      });
      try {
        const grant = await alice.createGrant({ name: "CLI integration", readScopes: ["personal"], writeScopes: ["personal"], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
        const login = await cli(["auth", "login", "--origin", origin, "--token-stdin", "--credential-store", "file"], grant.secret);
        assert.equal(login.code, 0); assert.equal(login.stdout.includes(grant.secret), false); assert.equal(login.stderr, "");
        const filename = path.join(directory, "认识 输入.json"); const request = createInput();
        await writeFile(filename, `\uFEFF${JSON.stringify(request)}`);
        loseWriteResponse = true; loseReceiptResponse = true;
        const unknown = await cli(["context", "add", "--input", filename]);
        assert.equal(unknown.code, 7); assert.equal(unknown.stdout, "");
        const failure = JSON.parse(unknown.stderr).error;
        assert.equal(failure.operationId, request.operationId);
        const retry = await cli(["context", "retry", "--retry", failure.recoveryFile]);
        assert.equal(retry.code, 0);
        const committed = JSON.parse(retry.stdout).result;
        assert.equal((await cli(["context", "show", committed.entryId])).code, 0);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM context_operations WHERE operation_id=$1", [request.operationId])).rows[0].count, 1);
        const update = { ...request, action: "update", entryId: committed.entryId, expectedRevision: 1, operationId: randomUUID() };
        await writeFile(filename, JSON.stringify(update)); assert.equal((await cli(["context", "update", committed.entryId, "--input", filename])).code, 0);
        await writeFile(filename, JSON.stringify({ ...update, operationId: randomUUID() }));
        const conflict = await cli(["context", "update", committed.entryId, "--input", filename]);
        assert.equal(conflict.code, 6); assert.equal(JSON.parse(conflict.stderr).error.currentRevision, 2);
        const recoveryFile = JSON.parse(conflict.stderr).error.recoveryFile;
        const recovery = JSON.parse(await readFile(recoveryFile, "utf8")); recovery.firstAttemptAt = new Date(Date.now() - 8 * 86400_000).toISOString();
        await writeFile(recoveryFile, JSON.stringify(recovery));
        assert.equal((await cli(["context", "retry", "--retry", recoveryFile])).code, 6);
        await alice.revokeGrant(grant.grant.id);
        assert.equal((await cli(["doctor"])).code, 3);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
    await t.test("account disable/deletion rejects existing grants and purges all Context rows", async () => {
      const grant = await alice.createGrant({ name: "lifecycle", readScopes: ["*"], writeScopes: ["*"], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
      const client = new ContextClient({ origin, token: grant.secret });
      await pool.query("INSERT INTO account_status_projections(subject_id,status,updated_by,reason,identity_updated_at) VALUES ('alice','disabled','admin','synthetic lifecycle test',now())");
      await assert.rejects(client.whoami(), { status: 401 });
      await pool.query("DELETE FROM account_status_projections WHERE subject_id='alice'");
      const lifecycle = new PostgresAccountLifecycleRepository(pool);
      const request = { subjectId: "alice", actorId: "admin", reason: "synthetic test", traceId: randomUUID(), idempotencyKey: randomUUID() };
      await lifecycle.beginDeletion(request);
      await assert.rejects(client.write(createInput()), { code: "account_deletion_started" });
      await lifecycle.purgeLiteasyData(request);
      for (const table of ["context_entries", "context_revisions", "context_operations", "context_grants"]) {
        assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0);
      }
      await assert.rejects(client.whoami(), { status: 401 });
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
