import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Tauri 2.11.1's bundler patches the first UNK token before packaging, then
// restores the original executable. All other bytes must remain identical.
// https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.1/crates/tauri-bundler/src/bundle.rs
export function verifyWindowsPayload(release, installed) {
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
  const offset = release.indexOf(marker);
  assert.ok(offset >= 0, "Release executable is missing the Tauri bundle type marker");
  const expected = Buffer.from(release);
  Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS").copy(expected, offset);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const evidence = { releaseSha256: hash(release), expectedInstalledSha256: hash(expected), installedSha256: hash(installed), bundleMarkerOffset: offset };
  assert.equal(evidence.installedSha256, evidence.expectedInstalledSha256,
    "Installed executable differs from the Release executable beyond Tauri's NSIS marker patch");
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [release, installed] = process.argv.slice(2);
  assert.ok(release && installed, "Usage: node verify-windows-payload.mjs <release.exe> <installed.exe>");
  console.log(JSON.stringify(verifyWindowsPayload(await readFile(release), await readFile(installed))));
}
