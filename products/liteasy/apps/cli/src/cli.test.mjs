import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { run } from "./main.mjs";
import { credentialKey, getCredential, readPrivateJson, saveCredential, systemCredential } from "./credentials.mjs";
import { manageSkills } from "./skills.mjs";
import { zoteroSnapshot } from "./zoteroMarkdown.mjs";
import { bindDirectory, directoryDefaults } from "./contextBinding.mjs";

test("stdout contains one JSON document and diagnostics never echo bad arguments", async () => {
  let stdout = ""; let stderr = "";
  const io = { stdout: { write: (value) => { stdout += value; } }, stderr: { write: (value) => { stderr += value; } }, stdin: Readable.from([]) };
  assert.equal(await run(["--version", "--json"], io), 0);
  assert.equal(JSON.parse(stdout).result.version, "0.1.0"); assert.equal(stderr, ""); stdout = "";
  assert.equal(await run(["--secret=do-not-print", "--json"], io), 2);
  assert.equal(stdout, ""); assert.equal(stderr.includes("do-not-print"), false);
});
test("file credentials bind to origin and subject and system writes send secrets on stdin", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "liteasy cli credentials "));
  const account = { origin: "https://example.test", subject: "alice", credentialStore: "file" };
  try {
    await saveCredential(directory, account, "synthetic-secret");
    assert.equal(await getCredential(directory, account), "synthetic-secret");
    assert.equal((await readFile(path.join(directory, "account.json"), "utf8")).includes("synthetic-secret"), false);
    assert.notEqual(credentialKey(account), credentialKey({ ...account, origin: "https://other.test" }));
    const calls = [];
    for (const platform of ["linux", "win32"]) await systemCredential("put", account, "synthetic-secret", async (...args) => { calls.push(args); return ""; }, platform);
    for (const [, args, input] of calls) { assert.equal(JSON.stringify(args).includes("synthetic-secret"), false); assert.ok(input.includes("synthetic-secret")); }
    if (process.platform !== "win32") {
      const file = path.join(directory, `${credentialKey(account)}.credential.json`);
      const { chmod } = await import("node:fs/promises"); await chmod(file, 0o644);
      await assert.rejects(readPrivateJson(file), { code: "credential_file_unsafe" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("skill install/upgrade/remove preserves local edits and unrelated skills for both hosts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "liteasy skills "));
  try {
    for (const agent of ["codex", "claude-code"]) {
      const values = { agent, scope: ["project"] };
      const installed = await manageSkills("install", values, directory);
      const file = path.join(installed.root, "liteasy-context", "SKILL.md");
      const original = await readFile(file, "utf8");
      assert.equal((await manageSkills("status", values, directory)).skills.length, 6);
      await writeFile(file, `${original}\nLocal customization\n`);
      await assert.rejects(manageSkills("upgrade", values, directory), { code: "skills_local_changes" });
      await assert.rejects(manageSkills("remove", values, directory), { code: "skills_local_changes" });
      assert.ok((await readFile(file, "utf8")).includes("Local customization"));
      await writeFile(file, original);
      await writeFile(path.join(installed.root, "unrelated.txt"), "keep");
      await manageSkills("remove", values, directory);
      assert.equal(await readFile(path.join(installed.root, "unrelated.txt"), "utf8"), "keep");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("Zotero paper backlinks do not become note identity and imported text stays a reference", () => {
  const values = { file: "笔记.md", "library-origin": "local-instance:synthetic" };
  const a = zoteroSnapshot(Buffer.from("# 第一份笔记\n我的笔记A [link](zotero://select/library/items/ABCDEF12)"), values);
  const b = zoteroSnapshot(Buffer.from("# 第二份笔记\n我的笔记B [link](zotero://select/library/items/ABCDEF12)"), values);
  assert.equal(a.kind, "reference"); assert.equal(a.basis, "imported");
  assert.equal(a.sourceRefs[0].sourceId, undefined);
  assert.notEqual(a.sourceRefs[0].contentHash, b.sourceRefs[0].contentHash);
  assert.equal(a.sourceRefs[1].locator, b.sourceRefs[1].locator);
});
test("two working directories can bind the same project without sharing credentials", async () => {
  const one = await mkdtemp(path.join(os.tmpdir(), "liteasy scope one "));
  const two = await mkdtemp(path.join(os.tmpdir(), "liteasy scope two "));
  try {
    await bindDirectory({ scope: ["project/gpu"] }, one);
    await bindDirectory({ scope: ["project/gpu"] }, two);
    assert.deepEqual(await directoryDefaults(one, "https://example.test"), { scopes: ["project/gpu"] });
    assert.deepEqual(await directoryDefaults(two, "https://example.test"), { scopes: ["project/gpu"] });
    assert.equal((await readFile(path.join(one, ".liteasy-context.json"), "utf8")).includes("secret"), false);
  } finally { await Promise.all([rm(one, { recursive: true, force: true }), rm(two, { recursive: true, force: true })]); }
});
