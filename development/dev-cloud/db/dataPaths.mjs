import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serviceReleaseDir = path.resolve(currentDir, "..");

function userDataRoot() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return process.env.APPDATA;
  }
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

function outsideReleaseDirectory(value, label) {
  const resolved = path.resolve(value);
  if (
    resolved === serviceReleaseDir ||
    resolved.startsWith(`${serviceReleaseDir}${path.sep}`)
  ) {
    throw new Error(`${label} must be outside the service release directory.`);
  }
  return resolved;
}

export function getDataDir() {
  const configured = process.env.LITEASY_DEV_CLOUD_DATA_DIR;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("LITEASY_DEV_CLOUD_DATA_DIR is required in production.");
  }
  return outsideReleaseDirectory(
    configured || path.join(userDataRoot(), "liteasy", "dev-cloud"),
    "LITEASY_DEV_CLOUD_DATA_DIR"
  );
}

export function getLibraryObjectDir() {
  const configured = process.env.LITEASY_LIBRARY_OBJECT_DIR;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("LITEASY_LIBRARY_OBJECT_DIR is required in production.");
  }
  return outsideReleaseDirectory(
    configured || path.join(getDataDir(), "storage-objects"),
    "LITEASY_LIBRARY_OBJECT_DIR"
  );
}

export function getDatabasePath() {
  const configured = process.env.LITEASY_DEV_CLOUD_DATABASE_PATH;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("LITEASY_DEV_CLOUD_DATABASE_PATH is required in production.");
  }
  return outsideReleaseDirectory(
    configured || path.join(getDataDir(), "liteasy.sqlite"),
    "LITEASY_DEV_CLOUD_DATABASE_PATH"
  );
}

export function getAuditArchiveDir() {
  const configured = process.env.LITEASY_AUDIT_ARCHIVE_DIR;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("LITEASY_AUDIT_ARCHIVE_DIR is required in production.");
  }
  return outsideReleaseDirectory(
    configured || path.join(getDataDir(), "audit-archive"),
    "LITEASY_AUDIT_ARCHIVE_DIR"
  );
}

export function getMineruCacheDir() {
  const configured = process.env.LITEASY_MINERU_CACHE_DIR;
  return outsideReleaseDirectory(
    configured || path.join(getDataDir(), "mineru-cache"),
    "LITEASY_MINERU_CACHE_DIR"
  );
}
