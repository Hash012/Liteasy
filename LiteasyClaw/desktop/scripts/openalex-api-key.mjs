import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const liteasyRoot = resolve(desktopDir, "..");
const workspaceRoot = resolve(liteasyRoot, "..");

export const defaultOpenAlexEnvPaths = Object.freeze([
  resolve(workspaceRoot, ".env.openalex.local"),
  resolve(liteasyRoot, ".env.openalex.local"),
  resolve(liteasyRoot, "services/dev-cloud/.env.openalex.local")
]);

function readDotenvField(content, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\s*${escapedField}\\s*=\\s*(.*?)\\s*$`, "m"));
  const value = (match?.[1]?.replace(/\s+#.*$/, "").trim() ?? "");
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

export function readOpenAlexApiKey(input = {}) {
  const configured = input.env?.LITEASY_OPENALEX_API_KEY?.trim();
  if (configured) {
    return configured;
  }
  for (const path of input.envPaths ?? defaultOpenAlexEnvPaths) {
    if (!fs.existsSync(path)) {
      continue;
    }
    const apiKey = readDotenvField(fs.readFileSync(path, "utf8"), "api_key");
    if (apiKey) {
      return apiKey;
    }
  }
  return "";
}

export function requireOpenAlexApiKey(input = {}) {
  const apiKey = readOpenAlexApiKey({ ...input, env: input.env ?? process.env });
  if (!apiKey) {
    throw new Error(
      "OpenAlex live eval requires LITEASY_OPENALEX_API_KEY or an api_key entry in .env.openalex.local."
    );
  }
  if (apiKey.length > 512 || /\s/.test(apiKey)) {
    throw new Error("OpenAlex API key format is invalid. Update the user configuration before running a live eval.");
  }
  return apiKey;
}
