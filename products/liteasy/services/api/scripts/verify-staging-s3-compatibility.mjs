import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createS3Client, S3ObjectStore } from "../src/s3ObjectStore.mjs";

const bucket = process.env.LITEASY_S3_BUCKET?.trim();
const endpoint = process.env.LITEASY_S3_ENDPOINT?.trim();
const region = process.env.LITEASY_S3_REGION?.trim();
if (!bucket || !endpoint || !region) {
  throw new Error("staging_s3_config_missing");
}
if (!bucket.includes("staging") || process.env.LITEASY_STAGING_S3_CONFIRM !== `verify:${bucket}`) {
  throw new Error("staging_s3_confirmation_required");
}
if (new URL(endpoint).protocol !== "https:") {
  throw new Error("staging_s3_https_required");
}
const operationId = randomUUID();
const config = {
  bucket,
  endpoint,
  forcePathStyle: process.env.LITEASY_S3_FORCE_PATH_STYLE === "true",
  prefix: `compatibility/${operationId}`,
  region
};
const client = createS3Client(config);
const store = new S3ObjectStore(config, { client });
const bytes = Buffer.from(`%PDF-1.7\nLiteasy staging storage compatibility ${operationId}\n`, "utf8");
const expectedHash = createHash("sha256").update(bytes).digest("hex");
let stagedKey;
let publishedKey;

try {
  const security = await store.assertSecurityConfiguration();
  const staged = await store.stagePdf(Readable.from([bytes]), { operationId: "probe" });
  stagedKey = staged.storageKey;
  assert.equal(staged.contentHash, expectedHash);
  const published = await store.publishStagedPdf(staged);
  stagedKey = undefined;
  publishedKey = published.storageKey;
  const downloaded = await store.openObject(published.storageKey);
  const downloadedBytes = Buffer.from(await downloaded.body.transformToByteArray());
  assert.deepEqual(downloadedBytes, bytes);
  assert.equal(downloaded.metadata.sha256, expectedHash);
  process.stdout.write(`${JSON.stringify({
    byteLength: bytes.length,
    compatibility: "aws-s3-contract",
    security,
    verified: true
  })}\n`);
} finally {
  if (stagedKey) await store.deleteKey(stagedKey).catch(() => undefined);
  if (publishedKey) await store.deleteKey(publishedKey).catch(() => undefined);
  client.destroy();
}
