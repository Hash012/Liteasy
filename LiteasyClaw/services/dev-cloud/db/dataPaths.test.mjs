import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getAuditArchiveDir,
  getDataDir,
  getDatabasePath,
  getLibraryObjectDir,
  getMineruCacheDir
} from "./dataPaths.mjs";

const originalEnvironment = process.env.NODE_ENV;
const originalDataDirectory = process.env.LITEASY_DEV_CLOUD_DATA_DIR;
const originalObjectDirectory = process.env.LITEASY_LIBRARY_OBJECT_DIR;
const originalDatabasePath = process.env.LITEASY_DEV_CLOUD_DATABASE_PATH;
const originalAuditDirectory = process.env.LITEASY_AUDIT_ARCHIVE_DIR;
const originalMineruCacheDirectory = process.env.LITEASY_MINERU_CACHE_DIR;

test.afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment;
  if (originalDataDirectory === undefined) delete process.env.LITEASY_DEV_CLOUD_DATA_DIR;
  else process.env.LITEASY_DEV_CLOUD_DATA_DIR = originalDataDirectory;
  if (originalObjectDirectory === undefined) delete process.env.LITEASY_LIBRARY_OBJECT_DIR;
  else process.env.LITEASY_LIBRARY_OBJECT_DIR = originalObjectDirectory;
  if (originalDatabasePath === undefined) delete process.env.LITEASY_DEV_CLOUD_DATABASE_PATH;
  else process.env.LITEASY_DEV_CLOUD_DATABASE_PATH = originalDatabasePath;
  if (originalAuditDirectory === undefined) delete process.env.LITEASY_AUDIT_ARCHIVE_DIR;
  else process.env.LITEASY_AUDIT_ARCHIVE_DIR = originalAuditDirectory;
  if (originalMineruCacheDirectory === undefined) delete process.env.LITEASY_MINERU_CACHE_DIR;
  else process.env.LITEASY_MINERU_CACHE_DIR = originalMineruCacheDirectory;
});

test("development defaults keep persistent data outside the service release", () => {
  process.env.NODE_ENV = "development";
  delete process.env.LITEASY_DEV_CLOUD_DATA_DIR;
  delete process.env.LITEASY_LIBRARY_OBJECT_DIR;
  delete process.env.LITEASY_DEV_CLOUD_DATABASE_PATH;
  delete process.env.LITEASY_AUDIT_ARCHIVE_DIR;
  delete process.env.LITEASY_MINERU_CACHE_DIR;
  assert.equal(getDataDir().startsWith(path.resolve(os.homedir())), true);
  assert.equal(getLibraryObjectDir(), path.join(getDataDir(), "storage-objects"));
  assert.equal(getDatabasePath(), path.join(getDataDir(), "liteasy.sqlite"));
  assert.equal(getAuditArchiveDir(), path.join(getDataDir(), "audit-archive"));
  assert.equal(getMineruCacheDir(), path.join(getDataDir(), "mineru-cache"));
});

test("production requires explicit database and object storage directories", () => {
  process.env.NODE_ENV = "production";
  delete process.env.LITEASY_DEV_CLOUD_DATA_DIR;
  delete process.env.LITEASY_LIBRARY_OBJECT_DIR;
  delete process.env.LITEASY_DEV_CLOUD_DATABASE_PATH;
  delete process.env.LITEASY_AUDIT_ARCHIVE_DIR;
  assert.throws(() => getDataDir(), /LITEASY_DEV_CLOUD_DATA_DIR is required/);
  process.env.LITEASY_DEV_CLOUD_DATA_DIR = path.join(os.tmpdir(), "liteasy-production-data");
  assert.throws(() => getLibraryObjectDir(), /LITEASY_LIBRARY_OBJECT_DIR is required/);
  assert.throws(() => getDatabasePath(), /LITEASY_DEV_CLOUD_DATABASE_PATH is required/);
  assert.throws(() => getAuditArchiveDir(), /LITEASY_AUDIT_ARCHIVE_DIR is required/);
});

test("configured persistent paths cannot point into the service release", () => {
  process.env.NODE_ENV = "development";
  process.env.LITEASY_DEV_CLOUD_DATA_DIR = path.resolve(".");
  assert.throws(() => getDataDir(), /outside the service release directory/);
  process.env.LITEASY_DEV_CLOUD_DATABASE_PATH = path.resolve("database.sqlite");
  assert.throws(() => getDatabasePath(), /outside the service release directory/);
  process.env.LITEASY_MINERU_CACHE_DIR = path.resolve("mineru-cache");
  assert.throws(() => getMineruCacheDir(), /outside the service release directory/);
});
