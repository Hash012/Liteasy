import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
if (!fs.existsSync(root)) throw new Error("admin_production_assets_missing");

const files = [];
const stack = [root];
while (stack.length) {
  const directory = stack.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) stack.push(target);
    else files.push(target);
  }
}

const forbidden = [
  /demo-session-/i,
  /mockProvider/,
  /fixture.*\.pdf/i,
  /VITE_LITEASY_IDENTITY_URL\s*=/
];
for (const file of files) {
  if (!/\.(?:html|js|css|json)$/i.test(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  const match = forbidden.find((pattern) => pattern.test(content));
  if (match) throw new Error(`admin_production_asset_forbidden:${path.relative(root, file)}:${match}`);
}

process.stdout.write(`${JSON.stringify({ checkedFiles: files.length, verified: true })}\n`);
