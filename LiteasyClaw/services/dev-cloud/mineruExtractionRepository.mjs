import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMineruCacheDir } from "./db/dataPaths.mjs";

const cacheSchemaVersion = 1;
const defaultParserVersion = "mineru-v1";
const defaultTtlMs = 7 * 24 * 60 * 60 * 1000;
const defaultMaximumBytes = 512 * 1024 * 1024;

function validateCacheKey(cacheKey) {
  if (typeof cacheKey !== "string" || !/^[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("invalid_mineru_cache_key");
  }
  return cacheKey;
}

function cachePath(cacheDirectory, cacheKey) {
  return path.join(cacheDirectory, `${validateCacheKey(cacheKey)}.json`);
}

function validateExtraction(extraction) {
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction) ||
    !Array.isArray(extraction.pages) || !Array.isArray(extraction.figures) ||
    typeof extraction.markdown !== "string") {
    throw new Error("invalid_mineru_extraction_cache_entry");
  }
  return extraction;
}

function readCacheEntry(filePath, cacheKey, now) {
  const entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    !entry ||
    entry.cacheKey !== cacheKey ||
    entry.schemaVersion !== cacheSchemaVersion ||
    typeof entry.expiresAt !== "string" ||
    Date.parse(entry.expiresAt) <= now
  ) {
    throw new Error("invalid_mineru_extraction_cache_entry");
  }
  return validateExtraction(entry.extraction);
}

export function createMineruExtractionCacheKey(bytes, parserVersion = defaultParserVersion) {
  return createHash("sha256").update(parserVersion).update("\0").update(bytes).digest("hex");
}

export function createMineruExtractionRepository(options = {}) {
  const cacheDirectory = options.cacheDirectory ?? getMineruCacheDir();
  const maximumBytes = options.maximumBytes ?? defaultMaximumBytes;
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? defaultTtlMs;

  function prune() {
    if (!fs.existsSync(cacheDirectory)) return { bytes: 0, entries: 0 };
    const candidates = fs.readdirSync(cacheDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
      .flatMap((entry) => {
        const filePath = path.join(cacheDirectory, entry.name);
        try {
          const stat = fs.statSync(filePath);
          const cacheKey = entry.name.slice(0, -".json".length);
          readCacheEntry(filePath, cacheKey, now());
          return [{ filePath, lastAccessedAt: stat.mtimeMs, size: stat.size }];
        } catch {
          fs.rmSync(filePath, { force: true });
          return [];
        }
      })
      .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
    let bytes = candidates.reduce((total, entry) => total + entry.size, 0);
    let entries = candidates.length;
    for (const candidate of candidates) {
      if (bytes <= maximumBytes) break;
      fs.rmSync(candidate.filePath, { force: true });
      bytes -= candidate.size;
      entries -= 1;
    }
    return { bytes, entries };
  }

  return {
    get(cacheKey) {
      const destination = cachePath(cacheDirectory, cacheKey);
      if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) {
        return null;
      }
      try {
        const extraction = readCacheEntry(destination, cacheKey, now());
        const accessedAt = new Date(now());
        fs.utimesSync(destination, accessedAt, accessedAt);
        return extraction;
      } catch {
        fs.rmSync(destination, { force: true });
        return null;
      }
    },

    prune,

    save(cacheKey, extraction) {
      const validatedKey = validateCacheKey(cacheKey);
      const validatedExtraction = validateExtraction(extraction);
      fs.mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
      const destination = cachePath(cacheDirectory, validatedKey);
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify({
          cacheKey: validatedKey,
          expiresAt: new Date(now() + ttlMs).toISOString(),
          extraction: validatedExtraction,
          savedAt: new Date(now()).toISOString(),
          schemaVersion: cacheSchemaVersion
        })}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        fs.renameSync(temporary, destination);
      } catch (error) {
        if (fs.existsSync(temporary)) {
          fs.unlinkSync(temporary);
        }
        throw error;
      }
      prune();
      return validatedExtraction;
    }
  };
}
