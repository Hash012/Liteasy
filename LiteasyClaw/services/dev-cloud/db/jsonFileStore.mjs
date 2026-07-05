import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(currentDir, "..", ".liteasy-data");

export function getDataDir() {
  return process.env.LITEASY_DEV_CLOUD_DATA_DIR || defaultDataDir;
}

function ensureDirectory() {
  fs.mkdirSync(getDataDir(), { recursive: true });
}

export function readJsonFile(filename, fallbackValue) {
  ensureDirectory();
  const filePath = path.join(getDataDir(), filename);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
    return fallbackValue;
  }

  const rawValue = fs.readFileSync(filePath, "utf8");
  return rawValue.length > 0 ? JSON.parse(rawValue) : fallbackValue;
}

export function writeJsonFile(filename, value) {
  ensureDirectory();
  const filePath = path.join(getDataDir(), filename);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}
