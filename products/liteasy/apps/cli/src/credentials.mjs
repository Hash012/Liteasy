import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliError } from "./cliError.mjs";

export function configDirectory(env = process.env) {
  return env.LITEASY_CONFIG_DIR ?? (process.platform === "win32"
    ? path.join(env.APPDATA ?? os.homedir(), "Liteasy", "context-cli")
    : path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "liteasy", "cli"));
}
export async function runProgram(program, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new CliError("credential_store_unavailable", "系统凭据库未响应。可明确选择 --credential-store session 或 file。", 8)); }, 8000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { if (output.length < 16384) output += chunk; });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new CliError("credential_store_unavailable", "系统凭据库不可用。可明确选择 --credential-store session 或 file。", 8)); });
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new CliError("credential_store_unavailable", "无法访问系统凭据库。可明确选择 --credential-store session 或 file。", 8));
    });
    child.stdin.end(input);
  });
}

// Static C# and PowerShell only; credential data travels over stdin, never argv.
const windowsVault = `
$ErrorActionPreference = 'Stop'
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LiteasyVault {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Write(ref Credential credential, uint flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Delete(string target, uint type, uint flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
  public static string Get(string target) {
    IntPtr ptr; if (!Read(target, 1, 0, out ptr)) throw new Exception("vault read failed");
    try { var c=(Credential)Marshal.PtrToStructure(ptr, typeof(Credential)); return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize/2); } finally { CredFree(ptr); }
  }
  public static void Put(string target, string subject, string secret) {
    var c=new Credential(); c.Type=1; c.TargetName=target; c.UserName=subject; c.Persist=2;
    c.CredentialBlob=Marshal.StringToCoTaskMemUni(secret); c.CredentialBlobSize=(uint)(secret.Length*2);
    try { if (!Write(ref c, 0)) throw new Exception("vault write failed"); } finally { Marshal.ZeroFreeCoTaskMemUnicode(c.CredentialBlob); }
  }
}
'@
switch ($data.action) {
  'get' { [Console]::Write([LiteasyVault]::Get($data.key)) }
  'put' { [LiteasyVault]::Put($data.key, $data.subject, $data.secret) }
  'remove' { if (![LiteasyVault]::Delete($data.key,1,0) -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw 'vault delete failed' } }
}
`;

export function credentialKey(account) {
  return createHash("sha256").update(`${account.origin}\0${account.subject}`).digest("hex");
}
async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CliError("config_path_unsafe", "配置目录必须是当前用户拥有的真实目录。", 8);
  if (process.platform === "win32") {
    // Restrict inheritance and grant only the current SID. Use argument arrays for paths with spaces.
    const sid = await runProgram("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"]);
    await runProgram("icacls.exe", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
  } else {
    if (stat.uid !== process.getuid()) throw new CliError("config_path_unsafe", "配置目录不属于当前用户。", 8);
    await chmod(directory, 0o700);
  }
}
export async function writePrivateJson(file, value) {
  await secureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
export async function readPrivateJson(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 ||
    (process.platform !== "win32" && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) {
    throw new CliError("credential_file_unsafe", "恢复或凭据文件必须仅允许当前用户读取。", 8);
  }
  try { return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")); }
  catch { throw new CliError("config_invalid", "配置或恢复文件格式无效。", 2); }
}
export async function loadAccount(directory) {
  try { return await readPrivateJson(path.join(directory, "account.json")); }
  catch (error) {
    if (error.code === "ENOENT") throw new CliError("authentication_required", "请先运行 liteasy auth login。", 3);
    throw error;
  }
}
export async function systemCredential(action, account, secret, run = runProgram, platform = process.platform) {
  const key = `liteasy-context:${credentialKey(account)}`;
  if (platform === "win32") return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsVault], JSON.stringify({ action, key, subject: account.subject, secret }));
  if (platform === "darwin") {
    if (action === "put") throw new CliError("credential_store_unsupported", "此版本尚未提供 macOS 安全写入；请选择 session 或 file。", 8);
    return run("security", action === "get" ? ["find-generic-password", "-s", key, "-a", account.subject, "-w"] : ["delete-generic-password", "-s", key, "-a", account.subject]);
  }
  const attributes = ["service", "liteasy-context", "account", credentialKey(account)];
  return run("secret-tool", action === "put" ? ["store", "--label=Liteasy Context", ...attributes] : [action === "get" ? "lookup" : "clear", ...attributes], action === "put" ? secret : "");
}
export async function saveCredential(directory, account, secret) {
  if (account.credentialStore === "system") await systemCredential("put", account, secret);
  else if (account.credentialStore === "file") await writePrivateJson(path.join(directory, `${credentialKey(account)}.credential.json`), { origin: account.origin, subject: account.subject, secret });
  else if (account.credentialStore !== "session") throw new CliError("credential_store_invalid", "凭据存储只支持 system、session 或 file。", 2);
  await writePrivateJson(path.join(directory, "account.json"), account);
}
export async function getCredential(directory, account) {
  if (account.credentialStore === "system") return systemCredential("get", account);
  if (account.credentialStore === "session") throw new CliError("session_token_required", "临时模式每次都需要 --token-stdin；不能与 --input - 共用 stdin。", 3);
  if (account.credentialStore !== "file") throw new CliError("config_invalid", "凭据配置无效。", 8);
  const value = await readPrivateJson(path.join(directory, `${credentialKey(account)}.credential.json`));
  if (value.origin !== account.origin || value.subject !== account.subject || typeof value.secret !== "string") throw new CliError("credential_binding_invalid", "凭据与当前账号不匹配。", 3);
  return value.secret;
}
export async function removeCredential(directory, account) {
  if (account.credentialStore === "system") await systemCredential("remove", account);
  if (account.credentialStore === "file") await rm(path.join(directory, `${credentialKey(account)}.credential.json`), { force: true });
  await rm(path.join(directory, "account.json"), { force: true });
}
