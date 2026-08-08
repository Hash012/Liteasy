import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const cdpEndpoint = process.env.LITEASY_TAURI_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const accountA = {
  email: process.env.LITEASY_ACCEPTANCE_ACCOUNT_A_EMAIL,
  password: process.env.LITEASY_ACCEPTANCE_ACCOUNT_A_PASSWORD
};
const accountB = {
  email: process.env.LITEASY_ACCEPTANCE_ACCOUNT_B_EMAIL,
  password: process.env.LITEASY_ACCEPTANCE_ACCOUNT_B_PASSWORD
};

for (const [name, value] of Object.entries({
  LITEASY_ACCEPTANCE_ACCOUNT_A_EMAIL: accountA.email,
  LITEASY_ACCEPTANCE_ACCOUNT_A_PASSWORD: accountA.password,
  LITEASY_ACCEPTANCE_ACCOUNT_B_EMAIL: accountB.email,
  LITEASY_ACCEPTANCE_ACCOUNT_B_PASSWORD: accountB.password
})) {
  if (!value) throw new Error(`${name} is required`);
}

const evidenceDirectory = path.resolve(
  process.env.LITEASY_ACCEPTANCE_EVIDENCE_DIR ??
    path.join(os.tmpdir(), `liteasy-windows-evidence-${Date.now()}`)
);
fs.mkdirSync(evidenceDirectory, { recursive: true });

const browser = await chromium.connectOverCDP(cdpEndpoint);
const page = browser.contexts().flatMap((context) => context.pages())[0];
if (!page) throw new Error("No WebView2 page is attached to the Tauri process.");

const invoke = (command, args = {}) => page.evaluate(
  ({ args: invocationArgs, command: invocationCommand }) =>
    window.__TAURI_INTERNALS__.invoke(invocationCommand, invocationArgs),
  { args, command }
);

async function snapshot() {
  return invoke("load_local_library_snapshot");
}

async function waitForSnapshot(predicate, message, timeoutMs = 15_000) {
  const startedAt = Date.now();
  let current;
  while (Date.now() - startedAt < timeoutMs) {
    current = await snapshot();
    if (predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${message}; last snapshot: ${JSON.stringify(current)}`);
}

async function expectInvokeRejected(command, args, expectedPattern) {
  let failure;
  try {
    await invoke(command, args);
  } catch (error) {
    failure = String(error);
  }
  assert.match(failure ?? "", expectedPattern);
  return failure;
}

async function login(account) {
  const dialog = page.getByRole("dialog", { name: "轻量登录面板" });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByLabel("邮箱").fill(account.email);
  await dialog.getByLabel("密码").fill(account.password);
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
}

async function logout() {
  await page.getByRole("button", { name: "个人中心" }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("dialog", { name: "轻量登录面板" }).waitFor({ state: "visible" });
}

function startExclusiveLock(filePath, readyPath) {
  const source = [
    `$file = [System.IO.File]::Open('${filePath.replaceAll("'", "''")}',`,
    "  [System.IO.FileMode]::Open,",
    "  [System.IO.FileAccess]::ReadWrite,",
    "  [System.IO.FileShare]::None)",
    `[System.IO.File]::WriteAllText('${readyPath.replaceAll("'", "''")}', 'ready')`,
    "try { Start-Sleep -Seconds 60 } finally { $file.Dispose() }"
  ].join("\n");
  return spawn("powershell.exe", ["-NoProfile", "-Command", source], {
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

const results = {
  cases: {},
  environment: {
    architecture: process.arch,
    platform: process.platform,
    release: os.release(),
    webviewTitle: await page.title()
  },
  finishedAt: null,
  startedAt: new Date().toISOString()
};

try {
  const initial = await snapshot();
  const root = initial.rootPath.replace(/^\\\\\?\\/, "");
  assert.equal(initial.entries.length, 0, "The isolated acceptance library must start empty");
  results.library = { libraryId: initial.libraryId, rootPath: initial.rootPath };

  const createdPath = path.join(root, "external-created.pdf");
  fs.writeFileSync(createdPath, "%PDF-1.7\nexternal version one\n");
  const afterCreate = await waitForSnapshot(
    (value) => value.entries.some((entry) => entry.path?.endsWith("external-created.pdf")),
    "External PDF creation was not observed"
  );
  const createdEntry = afterCreate.entries.find((entry) => entry.path?.endsWith("external-created.pdf"));

  fs.writeFileSync(createdPath, "%PDF-1.7\nexternal version two\n");
  const afterModify = await waitForSnapshot(
    (value) => value.entries.some((entry) =>
      entry.id === createdEntry.id && entry.contentHash !== createdEntry.contentHash),
    "External same-size PDF modification was not observed"
  );

  const renamedPath = path.join(root, "external-renamed.pdf");
  fs.renameSync(createdPath, renamedPath);
  const afterRename = await waitForSnapshot(
    (value) => value.entries.some((entry) =>
      entry.id === createdEntry.id && entry.path?.endsWith("external-renamed.pdf")),
    "External PDF rename was not observed"
  );

  fs.unlinkSync(renamedPath);
  const afterDelete = await waitForSnapshot(
    (value) => !value.entries.some((entry) => entry.id === createdEntry.id),
    "External PDF deletion was not observed"
  );
  results.cases.externalCreateModifyRenameDelete = {
    documentIdPreservedOnRename: true,
    passed: true,
    revisions: [afterCreate.revision, afterModify.revision, afterRename.revision, afterDelete.revision]
  };

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-junction-outside-"));
  fs.writeFileSync(path.join(outside, "outside.pdf"), "%PDF-1.7\noutside\n");
  const junctionPath = path.join(root, "junction-outside");
  if (fs.existsSync(junctionPath)) fs.unlinkSync(junctionPath);
  fs.symlinkSync(outside, junctionPath, "junction");
  const junctionError = await expectInvokeRejected(
    "create_local_library_folder",
    { name: "escape-attempt", parentPath: junctionPath },
    /根目录|文献库|符号链接|目录联接|范围|路径/
  );
  const afterJunction = await snapshot();
  assert.equal(afterJunction.entries.some((entry) => entry.path?.includes("outside.pdf")), false);
  fs.unlinkSync(junctionPath);
  results.cases.junctionEscapeRejected = { error: junctionError, passed: true };

  const caseFolder = await invoke("create_local_library_folder", { name: "CaseFolder" });
  const caseError = await expectInvokeRejected(
    "create_local_library_folder",
    { name: "casefolder" },
    /同名|冲突|存在/
  );
  assert.equal(caseFolder.folders.some((folder) => folder.name === "CaseFolder"), true);
  results.cases.caseConflict = { error: caseError, passed: true };

  const lockPath = path.join(root, "locked.pdf");
  fs.writeFileSync(lockPath, "%PDF-1.7\nlocked body\n");
  const withLockEntry = await waitForSnapshot(
    (value) => value.entries.some((entry) => entry.path?.endsWith("locked.pdf")),
    "Lock test PDF was not observed"
  );
  const lockedEntry = withLockEntry.entries.find((entry) => entry.path?.endsWith("locked.pdf"));
  const readyPath = path.join(evidenceDirectory, "file-lock.ready");
  const lockProcess = startExclusiveLock(lockPath, readyPath);
  await waitForFile(readyPath);
  let lockError;
  let trashed;
  try {
    trashed = await invoke("trash_local_library_resource", { sourcePath: lockPath });
  } catch (error) {
    lockError = String(error);
    assert.match(lockError, /拒绝访问|占用|另一个程序|无法|进程/);
    assert.equal(fs.existsSync(lockPath), true, "A failed locked-file trash must retain the source");
  }
  lockProcess.kill();
  await new Promise((resolve) => lockProcess.once("exit", resolve));
  trashed ??= await invoke("trash_local_library_resource", { sourcePath: lockPath });
  assert.equal(trashed.entries.some((entry) => entry.id === lockedEntry.id), false);
  assert.equal(trashed.trashEntries.some((entry) => entry.name === "locked.pdf"), true);
  results.cases.fileLockRecovery = {
    mode: lockError ? "retry-after-lock-release" : "atomic-move-while-handle-open",
    ...(lockError ? { error: lockError } : {}),
    passed: true
  };

  await login(accountA);
  const accountASnapshot = await snapshot();
  assert.equal(accountASnapshot.libraryId, initial.libraryId);
  assert.equal(accountASnapshot.rootPath, initial.rootPath);
  await logout();
  const loggedOutSnapshot = await snapshot();
  assert.equal(loggedOutSnapshot.libraryId, initial.libraryId);
  assert.equal(loggedOutSnapshot.folders.some((folder) => folder.name === "CaseFolder"), true);
  await login(accountB);
  const accountBSnapshot = await snapshot();
  assert.equal(accountBSnapshot.libraryId, initial.libraryId);
  assert.equal(accountBSnapshot.rootPath, initial.rootPath);
  assert.equal(accountBSnapshot.folders.some((folder) => folder.name === "CaseFolder"), true);
  results.cases.accountSwitchSameLocalRoot = { passed: true };
  results.cases.logoutLocalAvailable = { passed: true };

  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "filesystem-acceptance.png")
  });
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(evidenceDirectory, "filesystem-acceptance.json"),
    `${JSON.stringify(results, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify({ evidenceDirectory, results }, null, 2)}\n`);
} catch (error) {
  results.finishedAt = new Date().toISOString();
  results.failure = error instanceof Error ? error.stack : String(error);
  fs.writeFileSync(
    path.join(evidenceDirectory, "filesystem-acceptance.json"),
    `${JSON.stringify(results, null, 2)}\n`
  );
  throw error;
}
