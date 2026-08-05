import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryDir = dirname(fileURLToPath(import.meta.url));
const defaultCacheDirectory = resolve(repositoryDir, ".liteasy-data/mineru-cache");

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

function readCacheEntry(filePath, cacheKey) {
  const entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!entry || entry.cacheKey !== cacheKey) {
    throw new Error("invalid_mineru_extraction_cache_entry");
  }
  return validateExtraction(entry.extraction);
}

export function createMineruExtractionCacheKey(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createMineruExtractionRepository(options = {}) {
  const cacheDirectory = options.cacheDirectory ?? defaultCacheDirectory;

  return {
    get(cacheKey) {
      const destination = cachePath(cacheDirectory, cacheKey);
      if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) {
        return null;
      }
      try {
        return readCacheEntry(destination, cacheKey);
      } catch {
        // Corrupt or obsolete cache entries must never block a fresh extraction.
        return null;
      }
    },

    save(cacheKey, extraction) {
      const validatedKey = validateCacheKey(cacheKey);
      const validatedExtraction = validateExtraction(extraction);
      fs.mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
      const destination = cachePath(cacheDirectory, validatedKey);
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify({
          cacheKey: validatedKey,
          extraction: validatedExtraction,
          savedAt: new Date().toISOString()
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
      return validatedExtraction;
    }
  };
}
