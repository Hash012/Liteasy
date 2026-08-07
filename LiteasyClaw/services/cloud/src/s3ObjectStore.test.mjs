import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { S3ObjectStore } from "./s3ObjectStore.mjs";

function config() {
  return { bucket: "liteasy-private-documents", prefix: "documents", region: "test" };
}

class ConsumingUpload {
  constructor({ params }) {
    this.body = params.Body;
  }

  async done() {
    for await (const _chunk of this.body) {
      // Consume the stream as the multipart uploader would.
    }
  }
}

test("streams a real PDF into a private staging object and computes server-side identity", async () => {
  const commands = [];
  const store = new S3ObjectStore(config(), {
    UploadType: ConsumingUpload,
    client: { async send(command) { commands.push(command.constructor.name); } }
  });
  const result = await store.stagePdf(Readable.from([Buffer.from("%P"), Buffer.from("DF-1.7\nbody")]), {
    operationId: "upload-1"
  });
  assert.equal(result.byteLength, 13);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.storageKey, "documents/.staging/upload-1");
  assert.deepEqual(commands, []);
});

test("rejects invalid or oversized input and cleans its staging object", async () => {
  const commands = [];
  const store = new S3ObjectStore(config(), {
    UploadType: ConsumingUpload,
    client: { async send(command) { commands.push(command.constructor.name); } }
  });
  await assert.rejects(() => store.stagePdf(Readable.from(["not a pdf"]), { operationId: "bad" }), /signature_invalid/);
  assert.deepEqual(commands, ["DeleteObjectCommand"]);
  commands.length = 0;
  await assert.rejects(
    () => store.stagePdf(Readable.from(["%PDF-too-large"]), { maximumBytes: 5, operationId: "large" }),
    /too_large/
  );
  assert.deepEqual(commands, ["DeleteObjectCommand"]);
});

test("refuses buckets without complete private access, encryption and recovery protection", async () => {
  const client = {
    async send(command) {
      if (command.constructor.name === "GetPublicAccessBlockCommand") {
        return { PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true
        } };
      }
      if (command.constructor.name === "GetBucketEncryptionCommand") {
        return { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" } }] } };
      }
      if (command.constructor.name === "GetBucketVersioningCommand") return { Status: "Enabled" };
      if (command.constructor.name === "GetObjectLockConfigurationCommand") {
        const error = new Error("not configured");
        error.name = "NoSuchObjectLockConfiguration";
        throw error;
      }
      throw new Error(`unexpected ${command.constructor.name}`);
    }
  };
  const store = new S3ObjectStore(config(), { client });
  assert.deepEqual(await store.assertSecurityConfiguration(), {
    encryption: true,
    privateAccess: true,
    versioningOrObjectLock: true
  });

  const unsafe = new S3ObjectStore(config(), {
    client: { async send(command) {
      if (command.constructor.name === "GetPublicAccessBlockCommand") return { PublicAccessBlockConfiguration: {} };
      throw new Error("should not continue");
    } }
  });
  await assert.rejects(() => unsafe.assertSecurityConfiguration(), /public_access_not_blocked/);
});

test("publishes by content hash, verifies the result, and removes staging", async () => {
  const hash = "a".repeat(64);
  const calls = [];
  let headCount = 0;
  const client = {
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === "HeadObjectCommand") {
        headCount += 1;
        if (headCount === 1) {
          const error = new Error("missing");
          error.name = "NotFound";
          throw error;
        }
        return { ContentLength: 12, Metadata: { sha256: hash } };
      }
      return {};
    }
  };
  const store = new S3ObjectStore(config(), { client });
  const result = await store.publishStagedPdf({
    byteLength: 12,
    contentHash: hash,
    mediaType: "application/pdf",
    storageKey: "documents/.staging/upload"
  });
  assert.equal(result.storageKey, `documents/objects/aa/${hash}`);
  assert.deepEqual(calls, ["HeadObjectCommand", "CopyObjectCommand", "HeadObjectCommand", "DeleteObjectCommand"]);
});
