#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ContextClient, ContextClientError, normalizeContextOrigin } from "./sdk.mjs";
import { CliError, exitCode } from "./cliError.mjs";
import { configDirectory, getCredential, loadAccount, readPrivateJson, removeCredential, saveCredential, writePrivateJson } from "./credentials.mjs";

export const cliVersion = "0.1.0";
const cliSchema = "liteasy.cli/v1";
const options = {
  json: { type: "boolean" }, help: { type: "boolean" }, version: { type: "boolean" },
  origin: { type: "string" }, "token-stdin": { type: "boolean" }, "credential-store": { type: "string" },
  input: { type: "string" }, retry: { type: "string" }, "body-file": { type: "string" }, title: { type: "string" },
  kind: { type: "string", multiple: true }, scope: { type: "string", multiple: true }, tag: { type: "string", multiple: true },
  status: { type: "string" }, query: { type: "string" }, limit: { type: "string" }, cursor: { type: "string" },
  "expected-revision": { type: "string" }, "operation-id": { type: "string" }, format: { type: "string" },
  "max-chars": { type: "string" }, agent: { type: "string" }, file: { type: "string" },
  "note-id": { type: "string" }, "library-origin": { type: "string" }, locator: { type: "string" },
  "entry-id": { type: "string" }
};
const help = `liteasy ${cliVersion}
auth login --origin URL --token-stdin [--credential-store system|session|file]
auth status | auth logout
doctor [--json]
context add --input FILE | --kind idea --title TITLE --body-file FILE
context show ID | list [--scope SCOPE --kind KIND --tag TAG --query TEXT]
context update ID --input FILE
context archive|delete ID --expected-revision N
context history ID | export [--format json|markdown]
context receipt OPERATION_ID | retry --retry RECOVERY_FILE
context get [--scope SCOPE --query TEXT --max-chars 12000]
context use --scope project/slug [--origin URL]
skills install|status|upgrade|remove --agent codex|claude-code --scope user|project
source import zotero-md --file NOTE.md --library-origin ORIGIN [--note-id ID]
All commands accept --json. UTF-8 JSON files may contain a BOM; --input - reads stdin.
`;
async function stdinText(input, maximum = 128 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of input) {
    length += Buffer.byteLength(chunk);
    if (length > maximum) throw new CliError("input_too_large", "输入超过体积限制。", 2);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
}
async function hiddenToken(input, errorOutput) {
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new CliError("token_stdin_required", "请使用 --token-stdin 输入凭据。", 2);
  errorOutput.write("Context 凭据（输入隐藏）：");
  input.setRawMode(true); input.resume();
  try {
    return await new Promise((resolve, reject) => {
      let value = "";
      function finish() { input.off("data", receive); input.pause(); }
      function receive(chunk) {
        for (const character of chunk.toString("utf8")) {
          if (character === "\u0003") { finish(); reject(new CliError("input_cancelled", "已取消。", 2)); return; }
          if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else value += character;
          if (value.length > 200) { finish(); reject(new CliError("token_invalid", "凭据格式无效。", 2)); return; }
        }
      }
      input.on("data", receive);
    });
  } finally { input.setRawMode(false); input.pause(); errorOutput.write("\n"); }
}
async function fileText(file, input) {
  if (file === "-") return stdinText(input);
  try {
    const bytes = await readFile(file);
    if (bytes.length > 128 * 1024) throw new CliError("input_too_large", "输入超过 128 KiB。", 2);
    return bytes.toString("utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("input_file_unavailable", "无法读取输入文件。", 2);
  }
}
function jsonInput(value) {
  try {
    const input = JSON.parse(value);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    return input;
  } catch { throw new CliError("input_json_invalid", "输入不是有效的 JSON 对象。", 2); }
}
function filters(values) {
  return { ...(values.scope ? { scopes: values.scope } : {}), ...(values.kind ? { kinds: values.kind } : {}),
    ...(values.tag ? { tags: values.tag } : {}), ...(values.query ? { query: values.query } : {}),
    ...(values.status ? { status: values.status } : {}), ...(values.limit ? { limit: Number(values.limit) } : {}), ...(values.cursor ? { cursor: values.cursor } : {}) };
}
function content(entry) {
  const { schemaVersion, id, revision, owner, actor, createdAt, updatedAt, ...rest } = entry;
  return rest;
}
async function submit(client, account, directory, input, recovery) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input?.operationId ?? "")) throw new CliError("operation_id_invalid", "operationId 必须是 UUID。", 2);
  const file = path.join(directory, "recovery", `${input.operationId}.json`);
  if (!recovery) {
    try { recovery = await readPrivateJson(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (recovery && JSON.stringify(recovery.input) !== JSON.stringify(input)) throw new CliError("operation_input_changed", "原操作已有恢复记录，修改内容需使用新的 operationId。", 6);
  const who = await client.whoami();
  const firstAttemptAt = recovery?.firstAttemptAt ?? new Date().toISOString();
  if (recovery && (recovery.origin !== account.origin || recovery.subject !== account.subject ||
    !Number.isFinite(Date.parse(firstAttemptAt)) || Date.now() - Date.parse(firstAttemptAt) >= who.idempotencyWindowSeconds * 1000)) {
    throw new CliError("replay_window_or_account_mismatch", "恢复记录的账号不匹配或已超过幂等窗口；请先核查云端内容。", 6);
  }
  // Persist before the first write so a killed process still has the exact operation and first-attempt time.
  await writePrivateJson(file, { schemaVersion: "liteasy.context-recovery/v1", origin: account.origin, subject: account.subject, firstAttemptAt, input });
  try {
    if (recovery) {
      try { const receipt = await client.operation(input.operationId); await rm(file, { force: true }); return receipt; }
      catch (error) { if (error.status !== 404) throw error; }
    }
    try {
      const result = await client.write(input);
      await rm(file, { force: true }); return result;
    } catch (error) {
      if (!error.retryable) throw error;
      // An unknown write outcome is checked before any explicit replay.
      try { const receipt = await client.operation(input.operationId); await rm(file, { force: true }); return receipt; }
      catch { throw error; }
    }
  } catch (error) {
    error.operationId = input.operationId; error.recoveryFile = file;
    throw error;
  }
}

export async function execute(argv, io = {}) {
  const inputStream = io.stdin ?? process.stdin;
  const diagnostics = io.stderr ?? process.stderr;
  const directory = io.directory ?? configDirectory();
  let parsed;
  try { parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true }); }
  catch { throw new CliError("arguments_invalid", "命令参数无效，请运行 liteasy --help。", 2); }
  const { values, positionals: [group, action, id] } = parsed;
  if (values.version) return { version: cliVersion };
  if (values.help || !group) return { help };
  if (group === "skills") {
    const { manageSkills } = await import("./skills.mjs");
    return manageSkills(action, values, io.cwd ?? process.cwd());
  }
  if (group === "context" && action === "use") {
    const { bindDirectory } = await import("./contextBinding.mjs");
    return bindDirectory(values, io.cwd ?? process.cwd());
  }
  if (values["token-stdin"] && (values.input === "-" || values["body-file"] === "-")) throw new CliError("stdin_conflict", "凭据和业务内容不能共用 stdin，请为内容指定文件。", 2);
  if (group === "auth" && action === "login") {
    if (!values.origin) throw new CliError("origin_required", "登录需要 --origin。", 2);
    const origin = normalizeContextOrigin(values.origin);
    const token = (values["token-stdin"] ? await stdinText(inputStream, 4096) : await hiddenToken(inputStream, diagnostics)).trim();
    if (!/^lcg_[A-Za-z0-9_-]{43}$/.test(token)) throw new CliError("token_invalid", "请输入 Context 专用凭据。", 3);
    const client = new ContextClient({ origin, token });
    const who = await client.whoami();
    const account = { schemaVersion: "liteasy.cli-account/v1", origin, subject: who.subject, credentialStore: values["credential-store"] ?? "system" };
    await saveCredential(directory, account, token);
    return { ...who, origin, credentialStore: account.credentialStore };
  }
  const account = await loadAccount(directory);
  const configuredOrigin = normalizeContextOrigin(account.origin);
  if (values.origin && normalizeContextOrigin(values.origin) !== configuredOrigin) throw new CliError("credential_origin_mismatch", "凭据绑定了其他服务，请先针对目标服务重新登录。", 3);
  if (group === "auth" && action === "logout") {
    await removeCredential(directory, account);
    return { loggedOut: true, message: "已移除本机凭据；远端凭据仍需在账号设置中撤销。" };
  }
  const token = values["token-stdin"] ? (await stdinText(inputStream, 4096)).trim() : await getCredential(directory, account);
  const client = new ContextClient({ origin: configuredOrigin, token });
  const who = await client.whoami();
  if (who.subject !== account.subject) throw new CliError("credential_subject_mismatch", "当前凭据不属于已配置账号，请重新登录。", 3);
  if (!values.scope && ((group === "context" && action === "add" && !values.input) || group === "source")) {
    const { directoryDefaults } = await import("./contextBinding.mjs");
    values.scope = (await directoryDefaults(io.cwd ?? process.cwd(), account.origin)).scopes;
  }
  if (group === "auth" && action === "status") return { ...who, origin: configuredOrigin, credentialStore: account.credentialStore };
  if (group === "doctor") return { version: cliVersion, runtime: process.version, platform: process.platform, origin: configuredOrigin, reachable: true, identity: who };
  if (group === "source" && action === "import" && id === "zotero-md") {
    const { importZoteroMarkdown } = await import("./zoteroMarkdown.mjs");
    return importZoteroMarkdown({ client, values, readText: (file) => fileText(file, inputStream),
      submit: (write) => submit(client, account, directory, write) });
  }
  if (group !== "context") throw new CliError("command_unknown", "未知命令，请运行 liteasy --help。", 2);
  if (action === "show") return client.get(id);
  if (action === "receipt") return client.operation(id);
  if (action === "list" || action === "search") return client.list(filters(values));
  if (action === "history") return client.history(id, { ...(values.limit ? { limit: Number(values.limit) } : {}), ...(values.cursor ? { cursor: values.cursor } : {}) });
  if (action === "get") {
    const { directoryDefaults } = await import("./contextBinding.mjs");
    const defaults = values.scope ? {} : await directoryDefaults(io.cwd ?? process.cwd(), account.origin);
    return client.query({ schemaVersion: "liteasy.context-api/v1", ...defaults, ...filters(values), maxChars: Number(values["max-chars"] ?? 12000) });
  }
  if (action === "export") {
    const entries = [];
    let cursor;
    do {
      const page = await client.list({ ...filters(values), limit: 100, ...(cursor ? { cursor } : {}) });
      entries.push(...page.entries); cursor = page.nextCursor;
      if (entries.length > 10000) throw new CliError("export_too_large", "导出超过 10000 条，请缩小范围。", 2);
    } while (cursor);
    if (values.format && !["json", "markdown"].includes(values.format)) throw new CliError("format_invalid", "导出格式只支持 json 或 markdown。", 2);
    return values.format === "markdown" ? { markdown: entries.map((entry) => `# ${entry.title}\n\n${entry.bodyMarkdown}\n\n<!-- ${entry.id} revision=${entry.revision} -->`).join("\n\n") } : { schemaVersion: "liteasy.context-export/v1", entries };
  }
  if (action === "retry") {
    if (!values.retry) throw new CliError("recovery_required", "请使用 --retry 指定恢复文件。", 2);
    const recovery = await readPrivateJson(values.retry);
    if (recovery.schemaVersion !== "liteasy.context-recovery/v1") throw new CliError("recovery_invalid", "恢复文件版本无效。", 8);
    return submit(client, account, directory, recovery.input, recovery);
  }
  if (!["add", "update", "archive", "delete"].includes(action)) throw new CliError("command_unknown", "未知 Context 命令。", 2);
  let write;
  if (values.input) write = jsonInput(await fileText(values.input, inputStream));
  else {
    write = { schemaVersion: "liteasy.context-write/v1", operationId: values["operation-id"] ?? randomUUID(), action: action === "add" ? "create" : action === "delete" ? "delete" : "update" };
    if (action === "add") {
      if (!values.title || !values["body-file"] || values.kind?.length !== 1 || values.scope?.length > 1) throw new CliError("entry_required", "新增需要 --input，或一个 --kind、--title 与 --body-file，以及至多一个归组。", 2);
      write.entry = { scopeKey: values.scope?.[0] ?? "personal", kind: values.kind[0], title: values.title,
        bodyMarkdown: await fileText(values["body-file"], inputStream), basis: "user_authored", tags: values.tag ?? [] };
    } else {
      write.entryId = id; write.expectedRevision = Number(values["expected-revision"]);
      if (!Number.isSafeInteger(write.expectedRevision) || write.expectedRevision < 1) throw new CliError("revision_required", "修改和删除需要 expectedRevision。", 2);
      if (action === "archive") write.entry = { ...content((await client.get(id)).entry), status: "archived" };
      else if (action === "update") throw new CliError("update_input_required", "更新需要完整的 --input JSON 文件。", 2);
    }
  }
  const expectedAction = action === "add" ? "create" : action === "delete" ? "delete" : "update";
  if (write.action !== expectedAction || (action !== "add" && write.entryId !== id) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(write.operationId ?? "")) throw new CliError("write_input_invalid", "操作类型、路径或 operationId 无效。", 2);
  return submit(client, account, directory, write);
}

export async function run(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const result = await execute(argv, { ...io, stderr });
    if (argv.includes("--json")) stdout.write(`${JSON.stringify({ schemaVersion: cliSchema, result })}\n`);
    else stdout.write(`${result.help ?? result.markdown ?? JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const known = error instanceof CliError || error instanceof ContextClientError;
    stderr.write(`${JSON.stringify({ schemaVersion: cliSchema, error: {
      code: known ? error.code : "cli_unavailable", message: error instanceof CliError ? error.message : "操作未确认成功，请检查服务或恢复文件。",
      retryable: error.retryable === true,
      ...Object.fromEntries(["operationId", "recoveryFile", "currentRevision", "requestId"].filter((key) => error[key] !== undefined).map((key) => [key, error[key]]))
    } })}\n`);
    return known ? exitCode(error) : 8;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
