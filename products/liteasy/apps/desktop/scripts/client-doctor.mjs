import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopDir } from "./localClientProfile.mjs";

function probe(command, args) {
  try { return { ok: true, output: execFileSync(command, args, { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim() }; }
  catch { return { ok: false, output: "" }; }
}
export function collectClientDiagnostics({ os = platform(), cpu = arch(), kernel = release(), run = probe } = {}) {
  const expectedNode = readFileSync(join(desktopDir, ".nvmrc"), "utf8").trim();
  const windowsWorkflow = readFileSync(resolve(desktopDir, "../../../../.github/workflows/desktop-windows.yml"), "utf8");
  const expectedRust = windowsWorkflow.match(/RUST_TOOLCHAIN:\s*["']?([\d.]+)/)?.[1];
  const checks = [];
  const add = (id, status, observed, reason) => checks.push({ id, status, observed, reason });
  add("node", process.versions.node === expectedNode ? "available" : "degraded", process.versions.node, `Repository .nvmrc requests ${expectedNode}; use that version for release parity.`);
  const rust = run("rustc", ["--version"]);
  add("rust", !rust.ok ? "unavailable" : rust.output.includes(`rustc ${expectedRust} `) ? "available" : "degraded", rust.output || null, `Installer workflow requests Rust ${expectedRust ?? "(check workflow)"}; rustup/cargo must be on PATH.`);
  add("cargo", run("cargo", ["--version"]).ok ? "available" : "unavailable", null, "Install the repository Rust toolchain manually if unavailable.");
  if (os === "linux") {
    for (const library of ["gtk+-3.0", "webkit2gtk-4.1", "javascriptcoregtk-4.1", "libsoup-3.0"]) {
      const result = run("pkg-config", ["--modversion", library]);
      add(library, result.ok ? "available" : "unavailable", result.output || null, "Install the distribution's Tauri development packages; this command never installs them.");
    }
    add("c-compiler", run("cc", ["--version"]).ok ? "available" : "unavailable", null, "A native C compiler is required by bundled SQLite and other Rust dependencies.");
    add("display", process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? "available" : "unavailable", null, "A real GTK/WebKit display is required for the native window; browser tests do not substitute for it.");
    const secrets = run("gdbus", ["introspect", "--session", "--dest", "org.freedesktop.secrets", "--object-path", "/org/freedesktop/secrets"]);
    add("credential-service", secrets.ok ? "degraded" : "unavailable", null, secrets.ok ? "Secret Service responds; read/write credentials were not tested or accessed." : "Secret Service did not respond. Pure local reading remains usable; do not store secrets in plaintext.");
  } else if (os === "darwin") {
    const sdk = run("xcrun", ["--show-sdk-version"]);
    add("macos-sdk", sdk.ok ? "available" : "unavailable", sdk.output || null, "Install Xcode Command Line Tools manually when absent.");
    add("webview", "degraded", "WKWebView", "OS-provided WebView; launch the real application to verify it.");
    add("credential-service", "degraded", "Keychain", "No keychain items were accessed; native credential interaction remains unverified.");
  } else if (os === "win32") {
    add("msvc", run("where.exe", ["cl.exe"]).ok ? "available" : "unavailable", null, "Use a Visual Studio developer environment with C++ build tools; PATH detection alone is not a link test.");
    const webview = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\*','HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients\\*' -ErrorAction SilentlyContinue) | Where-Object { $_.name -like '*WebView2*' } | ForEach-Object { $_.pv }"]);
    add("webview", webview.ok && webview.output ? "available" : "unavailable", webview.output || null, "Install Microsoft Edge WebView2 Runtime manually if unavailable.");
    add("credential-service", "degraded", "Windows Credential Manager", "No credential items were accessed; validate native key storage separately.");
  } else add("platform", "unavailable", os, "This desktop development profile targets Windows, Linux and macOS only.");
  let temporary;
  try { temporary = mkdtempSync(join(tmpdir(), "liteasy-doctor-")); writeFileSync(join(temporary, "probe"), "synthetic probe", { mode: 0o600 }); add("temporary-profile", "available", null, "Only a new temporary probe was written; existing application directories were not opened."); }
  catch { add("temporary-profile", "unavailable", null, "Choose a writable temporary directory for dev:local."); }
  finally { if (temporary) rmSync(temporary, { recursive: true }); }
  return { schema: "liteasy.client-doctor/v1", platform: os, arch: cpu, kernel, wsl: os === "linux" && /microsoft/i.test(kernel), checks,
    nativeVerified: false, credentialsRead: false, automaticallyInstalled: false, networkServicesStarted: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = collectClientDiagnostics();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.checks.some(check => check.status === "unavailable" && check.id !== "credential-service") ? 1 : 0;
}
