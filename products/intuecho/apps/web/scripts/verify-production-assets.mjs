import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const forbidden = [
  "/v1/account/login",
  "127.0.0.1:8787",
  "intuecho.auth.development-session",
  "DevelopmentAuthForm",
  "developmentIdentity"
];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`production_asset_symlink_forbidden: ${target}`);
    if (entry.isDirectory()) return files(target);
    return entry.isFile() ? [target] : [];
  });
}

if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("production_assets_missing: run the Web build first");
}

const assets = files(root);
for (const file of assets) {
  const content = fs.readFileSync(file);
  for (const marker of forbidden) {
    if (content.includes(Buffer.from(marker))) {
      throw new Error(`production_asset_development_identity_forbidden: ${path.relative(root, file)} contains ${marker}`);
    }
  }
}

process.stdout.write(`${JSON.stringify({ files: assets.length, verified: true })}\n`);
