import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand
} from "@aws-sdk/client-s3";
import { createS3Client, S3ObjectStore } from "../src/s3ObjectStore.mjs";

const endpoint = process.env.LITEASY_TEST_S3_ENDPOINT;
const bucket = process.env.LITEASY_TEST_S3_BUCKET;
if (!endpoint || !bucket) throw new Error("LITEASY_TEST_S3_ENDPOINT and LITEASY_TEST_S3_BUCKET are required");
const parsed = new URL(endpoint);
if (!new Set(["127.0.0.1", "::1", "localhost"]).has(parsed.hostname) || !bucket.startsWith("liteasy-test-")) {
  throw new Error("integration_s3_forbidden: use a loopback endpoint and liteasy-test-* bucket");
}

const config = {
  bucket,
  endpoint,
  forcePathStyle: true,
  prefix: "documents",
  region: process.env.AWS_REGION || "us-east-1"
};
const client = createS3Client(config);
try {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(new PutBucketVersioningCommand({
    Bucket: bucket,
    VersioningConfiguration: { Status: "Enabled" }
  }));

  const bytes = Buffer.from("%PDF-1.7\nLiteasy S3 integration\n", "utf8");
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  const store = new S3ObjectStore(config, { client });
  const staged = await store.stagePdf(Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]), {
    operationId: "integration-upload"
  });
  assert.equal(staged.contentHash, expectedHash);
  assert.equal(staged.byteLength, bytes.length);
  const published = await store.publishStagedPdf(staged);
  assert.equal(published.storageKey, `documents/objects/${expectedHash.slice(0, 2)}/${expectedHash}`);
  const downloaded = await store.openObject(published.storageKey);
  const downloadedBytes = Buffer.from(await downloaded.body.transformToByteArray());
  assert.deepEqual(downloadedBytes, bytes);
  assert.equal(downloaded.metadata.sha256, expectedHash);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: published.storageKey }));
  process.stdout.write(`${JSON.stringify({
    byteLength: bytes.length,
    contentHash: expectedHash,
    verified: true
  })}\n`);
} finally {
  client.destroy();
}
