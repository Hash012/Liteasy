import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const defaultMaximumPdfBytes = 256 * 1024 * 1024;

function commandFailedWithMissingConfiguration(error) {
  return new Set([
    "NoSuchObjectLockConfiguration",
    "ObjectLockConfigurationNotFoundError",
    "NoSuchPublicAccessBlockConfiguration"
  ]).has(error?.name);
}

function copySource(bucket, key) {
  return `/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isMissingObject(error) {
  return error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
}

function createPdfValidationTransform(maximumBytes) {
  let byteLength = 0;
  let signature = Buffer.alloc(0);
  const hash = createHash("sha256");
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.length;
      if (byteLength > maximumBytes) {
        callback(new Error("storage_pdf_too_large"));
        return;
      }
      if (signature.length < 5) {
        signature = Buffer.concat([signature, bytes.subarray(0, 5 - signature.length)]);
      }
      hash.update(bytes);
      callback(null, bytes);
    },
    flush(callback) {
      if (byteLength === 0) callback(new Error("storage_pdf_empty"));
      else if (!signature.equals(Buffer.from("%PDF-"))) callback(new Error("storage_pdf_signature_invalid"));
      else callback();
    }
  });
  return {
    digest: () => hash.digest("hex"),
    length: () => byteLength,
    transform
  };
}

export function createS3Client(config, S3ClientType = S3Client) {
  return new S3ClientType({
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region
  });
}

export class S3ObjectStore {
  constructor(config, { client = createS3Client(config), UploadType = Upload } = {}) {
    this.bucket = config.bucket;
    this.client = client;
    this.prefix = config.prefix;
    this.UploadType = UploadType;
  }

  stagingKey(operationId = randomUUID()) {
    return `${this.prefix}/.staging/${operationId}`;
  }

  objectKey(contentHash) {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("storage_content_hash_invalid");
    return `${this.prefix}/objects/${contentHash.slice(0, 2)}/${contentHash}`;
  }

  async assertSecurityConfiguration() {
    const publicAccess = await this.client.send(new GetPublicAccessBlockCommand({ Bucket: this.bucket }));
    const block = publicAccess.PublicAccessBlockConfiguration;
    if (!block || ![block.BlockPublicAcls, block.IgnorePublicAcls, block.BlockPublicPolicy, block.RestrictPublicBuckets].every(Boolean)) {
      throw new Error("storage_bucket_public_access_not_blocked");
    }

    const encryption = await this.client.send(new GetBucketEncryptionCommand({ Bucket: this.bucket }));
    const encryptionRules = encryption.ServerSideEncryptionConfiguration?.Rules ?? [];
    if (!encryptionRules.some((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm)) {
      throw new Error("storage_bucket_encryption_missing");
    }

    const versioning = await this.client.send(new GetBucketVersioningCommand({ Bucket: this.bucket }));
    let objectLockEnabled = false;
    try {
      const objectLock = await this.client.send(new GetObjectLockConfigurationCommand({ Bucket: this.bucket }));
      objectLockEnabled = objectLock.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled";
    } catch (error) {
      if (!commandFailedWithMissingConfiguration(error)) throw error;
    }
    if (versioning.Status !== "Enabled" && !objectLockEnabled) {
      throw new Error("storage_bucket_recovery_protection_missing");
    }
    return {
      encryption: true,
      privateAccess: true,
      versioningOrObjectLock: true
    };
  }

  async stagePdf(readable, { maximumBytes = defaultMaximumPdfBytes, operationId } = {}) {
    if (!readable || typeof readable.pipe !== "function") throw new Error("storage_pdf_stream_required");
    const storageKey = this.stagingKey(operationId);
    const validation = createPdfValidationTransform(maximumBytes);
    const upload = new this.UploadType({
      client: this.client,
      leavePartsOnError: false,
      params: {
        Bucket: this.bucket,
        Body: validation.transform,
        ContentType: "application/pdf",
        Key: storageKey,
        Metadata: { state: "staging" }
      }
    });
    try {
      await Promise.all([pipeline(readable, validation.transform), upload.done()]);
      return {
        byteLength: validation.length(),
        contentHash: validation.digest(),
        mediaType: "application/pdf",
        storageKey
      };
    } catch (error) {
      await this.deleteKey(storageKey).catch(() => {});
      throw error;
    }
  }

  async publishStagedPdf(staged) {
    const finalKey = this.objectKey(staged.contentHash);
    let existing;
    try {
      existing = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: finalKey }));
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
    if (existing) {
      if (Number(existing.ContentLength) !== staged.byteLength || existing.Metadata?.sha256 !== staged.contentHash) {
        throw new Error("storage_existing_object_integrity_mismatch");
      }
    } else {
      await this.client.send(new CopyObjectCommand({
        Bucket: this.bucket,
        ContentType: "application/pdf",
        CopySource: copySource(this.bucket, staged.storageKey),
        Key: finalKey,
        Metadata: {
          "byte-length": String(staged.byteLength),
          sha256: staged.contentHash
        },
        MetadataDirective: "REPLACE"
      }));
      const published = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: finalKey }));
      if (Number(published.ContentLength) !== staged.byteLength || published.Metadata?.sha256 !== staged.contentHash) {
        throw new Error("storage_published_object_integrity_mismatch");
      }
    }
    await this.deleteKey(staged.storageKey);
    return { ...staged, storageKey: finalKey };
  }

  async openObject(storageKey) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    if (!response.Body) throw new Error("storage_object_body_missing");
    return {
      body: response.Body,
      byteLength: Number(response.ContentLength),
      mediaType: response.ContentType ?? "application/octet-stream",
      metadata: response.Metadata ?? {}
    };
  }

  async deleteKey(storageKey) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }
}

export { defaultMaximumPdfBytes };
