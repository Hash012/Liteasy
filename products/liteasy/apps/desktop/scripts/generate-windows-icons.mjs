import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve("@tauri-apps/cli/package.json")), "tauri.js");
const source = path.resolve(desktop, "../../assets/brand/liteasy-mark.svg");
const output = mkdtempSync(path.join(tmpdir(), "liteasy-windows-icons-"));
try {
  execFileSync(process.execPath, [cli, "icon", source, "--output", output], { cwd: desktop, stdio: "inherit" });
  // Tauri also generates mobile/macOS assets; only publish the Windows resources.
  for (const name of readdirSync(output)) {
    if (name === "icon.ico" || name.endsWith(".png")) {
      copyFileSync(path.join(output, name), path.join(desktop, "src-tauri/icons", name));
    }
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
