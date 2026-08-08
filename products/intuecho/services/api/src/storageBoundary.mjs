import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const serviceReleaseDirectory = path.resolve(sourceDirectory, "..");
const legacyDatabasePath = path.join(serviceReleaseDirectory, "data", "intuecho.db");
const allowedEnvironments = new Set(["development", "test"]);

function environmentName(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || "development";
}

function userDataRoot() {
  if (process.platform === "win32" && process.env.APPDATA) return process.env.APPDATA;
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

function outsideReleaseDirectory(value) {
  const resolved = path.resolve(value);
  if (
    resolved === serviceReleaseDirectory ||
    resolved.startsWith(`${serviceReleaseDirectory}${path.sep}`)
  ) {
    throw new Error("intuecho_data_in_release_forbidden: database path must be outside the service release");
  }
  return resolved;
}

function fileHash(filePath) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function secureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function copyLegacyDatabase(source, target) {
  const legacy = new Database(source);
  try {
    legacy.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    legacy.close();
  }
  const directory = path.dirname(target);
  secureDirectory(directory);
  const temporary = path.join(directory, `.intuecho-migration-${randomUUID()}.sqlite`);
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(temporary, 0o600);
  const descriptor = fs.openSync(temporary, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (fileHash(source) !== fileHash(temporary)) {
    fs.rmSync(temporary, { force: true });
    throw new Error("intuecho_legacy_migration_hash_mismatch");
  }
  fs.renameSync(temporary, target);
  return source;
}

export function assertIntuechoDevelopmentBoundary(environment = process.env.NODE_ENV) {
  const normalized = environmentName(environment);
  if (!allowedEnvironments.has(normalized)) {
    throw new Error(
      "intuecho_nonproduction_only: the current Intuecho API uses SQLite and cannot run as staging or production"
    );
  }
  return normalized;
}

export function prepareIntuechoDatabasePath({
  configuredPath = process.env.INTUECHO_DATABASE_PATH,
  defaultPath = path.join(userDataRoot(), "liteasy", "intuecho", "intuecho.sqlite"),
  legacyPath = legacyDatabasePath
} = {}) {
  const databasePath = outsideReleaseDirectory(configuredPath || defaultPath);
  secureDirectory(path.dirname(databasePath));
  let migratedFrom = null;
  if (
    !configuredPath &&
    !fs.existsSync(databasePath) &&
    fs.statSync(legacyPath, { throwIfNoEntry: false })?.isFile()
  ) {
    migratedFrom = copyLegacyDatabase(legacyPath, databasePath);
  }
  return { databasePath, migratedFrom };
}

export function secureIntuechoDatabaseFiles(databasePath) {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
  }
}
