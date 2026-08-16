import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const buildDirectory = path.resolve(process.cwd(), "dist");
const forbiddenDirectories = ["fixtures", "papers"];
const forbiddenFileNamePatterns = [
  { label: "bundled browser fixture", pattern: /BrowserFixture/i }
];
const forbiddenTextPatterns = [
  { label: "fixture document reference", pattern: /\/(?:fixtures|papers)\/[^\s"'`]+\.(?:pdf|png)\b/i },
  { label: "removed mock provider", pattern: /mockProvider|mockRetriever|demoKnowledgeBase/ },
  {
    label: "demo credential or session entry",
    pattern: /demo[_-]?(?:account|credential|login|password|session)|(?:account|credential|login|password|session)[_-]?demo/i
  }
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

const requiredReleaseEndpoints = [
  "VITE_LITEASY_CLOUD_URL",
  "VITE_FORUM_API_URL",
  "VITE_FORUM_WEB_URL"
];

export function verifyProductionAssets(directory = buildDirectory, env = process.env) {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`production_asset_boundary: build directory does not exist: ${directory}`);
  }
  const violations = [];
  for (const name of forbiddenDirectories) {
    if (fs.existsSync(path.join(directory, name))) {
      violations.push(`bundled test directory: ${name}`);
    }
  }
  for (const filePath of walk(directory)) {
    for (const check of forbiddenFileNamePatterns) {
      if (check.pattern.test(path.basename(filePath))) {
        violations.push(`${check.label}: ${path.relative(directory, filePath)}`);
      }
    }
    if (!/\.(?:css|html|js|json|mjs)$/i.test(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const check of forbiddenTextPatterns) {
      if (check.pattern.test(content)) {
        violations.push(`${check.label}: ${path.relative(directory, filePath)}`);
      }
    }
  }
  for (const name of requiredReleaseEndpoints) {
    const expectedEndpoint = env[name]?.trim();
    if (!expectedEndpoint) {
      violations.push(`${name} is required for production builds`);
      continue;
    }
    const endpointBundled = walk(directory).some((filePath) => (
      /\.(?:html|js|json|mjs)$/i.test(filePath) &&
      fs.readFileSync(filePath, "utf8").includes(expectedEndpoint)
    ));
    if (!endpointBundled) {
      violations.push(`${name} is missing from production assets`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`production_asset_boundary:\n${violations.join("\n")}`);
  }
  return { checkedFiles: walk(directory).length, verified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(verifyProductionAssets())}\n`);
}
