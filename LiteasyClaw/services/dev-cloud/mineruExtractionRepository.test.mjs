import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMineruExtractionCacheKey,
  createMineruExtractionRepository
} from "./mineruExtractionRepository.mjs";

test("persists a MinerU extraction by PDF content hash for reuse after a restart", (context) => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-mineru-cache-"));
  context.after(() => fs.rmSync(cacheDirectory, { force: true, recursive: true }));
  const cacheKey = createMineruExtractionCacheKey(Buffer.from("%PDF-example"));
  const extraction = {
    figures: [{ dataUrl: "data:image/png;base64,AA==", id: "figure-1", page: 1 }],
    markdown: "# Extracted",
    pages: [{ page: 1, text: "Extracted", textExtraction: "mineru" }]
  };

  createMineruExtractionRepository({ cacheDirectory }).save(cacheKey, extraction);
  const afterRestart = createMineruExtractionRepository({ cacheDirectory });

  assert.deepEqual(afterRestart.get(cacheKey), extraction);
  assert.equal(afterRestart.get(createMineruExtractionCacheKey(Buffer.from("%PDF-other"))), null);
});

test("ignores a corrupt MinerU cache entry so the caller can extract again", (context) => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-mineru-cache-"));
  context.after(() => fs.rmSync(cacheDirectory, { force: true, recursive: true }));
  const cacheKey = createMineruExtractionCacheKey(Buffer.from("%PDF-example"));
  fs.writeFileSync(path.join(cacheDirectory, `${cacheKey}.json`), "not json");

  assert.equal(createMineruExtractionRepository({ cacheDirectory }).get(cacheKey), null);
  assert.equal(fs.existsSync(path.join(cacheDirectory, `${cacheKey}.json`)), false);
});

test("expires and capacity-evicts MinerU extraction cache entries", (context) => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-mineru-cache-"));
  context.after(() => fs.rmSync(cacheDirectory, { force: true, recursive: true }));
  let timestamp = Date.parse("2026-08-07T00:00:00.000Z");
  const extraction = {
    figures: [],
    markdown: "# Extracted",
    pages: [{ page: 1, text: "Extracted", textExtraction: "mineru" }]
  };
  const expiring = createMineruExtractionRepository({
    cacheDirectory,
    now: () => timestamp,
    ttlMs: 1_000
  });
  const expiringKey = createMineruExtractionCacheKey(Buffer.from("%PDF-expiring"));
  expiring.save(expiringKey, extraction);
  timestamp += 1_001;
  assert.equal(expiring.get(expiringKey), null);

  const bounded = createMineruExtractionRepository({ cacheDirectory, maximumBytes: 1 });
  const boundedKey = createMineruExtractionCacheKey(Buffer.from("%PDF-bounded"));
  bounded.save(boundedKey, extraction);
  assert.equal(bounded.get(boundedKey), null);
  assert.deepEqual(bounded.prune(), { bytes: 0, entries: 0 });
});

test("includes the parser version in MinerU cache identity", () => {
  const bytes = Buffer.from("%PDF-versioned");
  assert.notEqual(
    createMineruExtractionCacheKey(bytes, "mineru-v1"),
    createMineruExtractionCacheKey(bytes, "mineru-v2")
  );
});
