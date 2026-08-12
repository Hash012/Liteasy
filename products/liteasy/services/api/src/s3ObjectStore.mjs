import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketAclCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const defaultMaximumPdfBytes = 256 * 1024 * 1024;
const supportedSecurityProfiles = new Set(["aws-s3", "aliyun-oss"]);
const acceptedOssEncryptionModes = new Set(["AES256", "KMS", "aws:kms"]);

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

function encodedKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function aliyunBucketUrl(config) {
  const url = new URL(config.endpoint);
  url.hostname = `${config.bucket}.${url.hostname}`;
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function responseStatus(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000)
    });
    return response.status;
  } catch {
    throw new Error("storage_bucket_anonymous_access_check_failed");
  } finally {
    await response?.body?.cancel?.().catch(() => undefined);
  }
}

function assertAnonymousDenied(status) {
  if (status !== 401 && status !== 403) {
    throw new Error("storage_bucket_anonymous_access_not_blocked");
  }
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
  constructor(config, {
    anonymousFetch = fetch,
    client = createS3Client(config),
    UploadType = Upload
  } = {}) {
    const securityProfile = config.securityProfile ?? "aws-s3";
    if (!supportedSecurityProfiles.has(securityProfile)) {
      throw new TypeError("storage_security_profile_invalid");
    }
    this.bucket = config.bucket;
    this.client = client;
    this.endpoint = config.endpoint;
    this.forcePathStyle = config.forcePathStyle ?? false;
    this.prefix = config.prefix;
    this.securityProfile = securityProfile;
    this.anonymousFetch = anonymousFetch;
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
    if (this.securityProfile === "aliyun-oss") {
      return this.assertAliyunOssSecurityConfiguration();
    }
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

  async assertAliyunOssSecurityConfiguration() {
    if (!this.endpoint || this.forcePathStyle) throw new Error("storage_aliyun_oss_endpoint_invalid");

    const acl = await this.client.send(new GetBucketAclCommand({ Bucket: this.bucket }));
    const ownerId = acl.Owner?.ID;
    const grants = acl.Grants ?? [];
    const ownerOnly = typeof ownerId === "string" && ownerId.length > 0 && grants.length === 1 &&
      grants[0].Grantee?.Type === "CanonicalUser" && grants[0].Grantee?.ID === ownerId &&
      grants[0].Permission === "FULL_CONTROL" && !grants[0].Grantee?.URI;
    if (!ownerOnly) throw new Error("storage_bucket_public_access_not_blocked");

    const versioning = await this.client.send(new GetBucketVersioningCommand({ Bucket: this.bucket }));
    if (versioning.Status !== "Enabled") {
      throw new Error("storage_bucket_recovery_protection_missing");
    }

    const operationId = randomUUID();
    const objectProbeKey = `compatibility/security/${operationId}`;
    const stagingProbeKey = `${this.prefix}/.staging/.security/${operationId}`;
    const anonymousWriteKey = `${this.prefix}/.staging/.security/${operationId}-anonymous-write`;
    const probeBytes = Buffer.from("Liteasy OSS security probe", "utf8");
    const bucketUrl = aliyunBucketUrl({ bucket: this.bucket, endpoint: this.endpoint });
    const objectUrl = new URL(encodedKey(objectProbeKey), bucketUrl);
    const stagingUrl = new URL(encodedKey(stagingProbeKey), bucketUrl);
    const anonymousWriteUrl = new URL(encodedKey(anonymousWriteKey), bucketUrl);
    const listUrl = new URL(bucketUrl);
    listUrl.searchParams.set("list-type", "2");
    listUrl.searchParams.set("max-keys", "1");
    listUrl.searchParams.set("prefix", this.prefix);
    let anonymousWriteMayExist = false;

    try {
      await this.client.send(new PutObjectCommand({
        Body: probeBytes,
        Bucket: this.bucket,
        ContentType: "application/octet-stream",
        Key: objectProbeKey,
        Metadata: { purpose: "security-probe" }
      }));
      const head = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectProbeKey
      }));
      if (!acceptedOssEncryptionModes.has(head.ServerSideEncryption)) {
        throw new Error("storage_bucket_encryption_missing");
      }

      assertAnonymousDenied(await responseStatus(this.anonymousFetch, objectUrl, { method: "HEAD" }));
      assertAnonymousDenied(await responseStatus(this.anonymousFetch, stagingUrl, { method: "HEAD" }));
      assertAnonymousDenied(await responseStatus(this.anonymousFetch, listUrl, { method: "GET" }));
      const writeStatus = await responseStatus(this.anonymousFetch, anonymousWriteUrl, {
        body: probeBytes,
        headers: { "content-type": "application/octet-stream" },
        method: "PUT"
      });
      anonymousWriteMayExist = writeStatus >= 200 && writeStatus < 300;
      assertAnonymousDenied(writeStatus);
    } finally {
      await this.deleteKey(objectProbeKey).catch(() => undefined);
      if (anonymousWriteMayExist) await this.deleteKey(anonymousWriteKey).catch(() => undefined);
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

  async putImmutableObject(input, {
    contentHash,
    maximumBytes = 16 * 1024 * 1024,
    mediaType,
    metadata = {}
  } = {}) {
    const bytes = Buffer.from(input ?? []);
    if (bytes.length === 0 || bytes.length > maximumBytes) throw new Error("storage_object_size_invalid");
    if (!/^[a-f0-9]{64}$/.test(contentHash ?? "") ||
      createHash("sha256").update(bytes).digest("hex") !== contentHash) {
      throw new Error("storage_content_hash_invalid");
    }
    if (typeof mediaType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mediaType)) {
      throw new Error("storage_media_type_invalid");
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      Object.entries(metadata).some(([key, value]) => !/^[a-z0-9-]{1,80}$/.test(key) || typeof value !== "string" || value.length > 512)) {
      throw new Error("storage_metadata_invalid");
    }
    const storageKey = this.objectKey(contentHash);
    let existing;
    try {
      existing = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
    if (!existing) {
      await this.client.send(new PutObjectCommand({
        Body: bytes,
        Bucket: this.bucket,
        ContentType: mediaType,
        Key: storageKey,
        Metadata: {
          ...metadata,
          "byte-length": String(bytes.length),
          sha256: contentHash
        }
      }));
      existing = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    }
    if (Number(existing.ContentLength) !== bytes.length || existing.ContentType !== mediaType || existing.Metadata?.sha256 !== contentHash) {
      throw new Error("storage_existing_object_integrity_mismatch");
    }
    return { byteLength: bytes.length, contentHash, mediaType, storageKey };
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

  async listStagingObjects({ before, limit = 100 } = {}) {
    const cutoff = before instanceof Date ? before : new Date(before);
    if (!Number.isFinite(cutoff.getTime())) throw new Error("storage_staging_cutoff_invalid");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("storage_maintenance_limit_invalid");
    }
    const prefix = `${this.prefix}/.staging/`;
    const objects = [];
    let continuationToken;
    let remaining = limit;
    while (remaining > 0) {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        ContinuationToken: continuationToken,
        MaxKeys: remaining,
        Prefix: prefix
      }));
      const contents = (response.Contents ?? []).slice(0, remaining);
      remaining -= contents.length;
      for (const object of contents) {
        const lastModified = object.LastModified instanceof Date
          ? object.LastModified
          : new Date(object.LastModified);
        if (typeof object.Key !== "string" || !object.Key.startsWith(prefix) ||
          !Number.isFinite(lastModified.getTime()) || lastModified >= cutoff) {
          continue;
        }
        objects.push({ lastModified: lastModified.toISOString(), storageKey: object.Key });
      }
      if (!response.IsTruncated || remaining === 0) break;
      if (typeof response.NextContinuationToken !== "string" ||
        response.NextContinuationToken === continuationToken) {
        throw new Error("storage_staging_pagination_invalid");
      }
      continuationToken = response.NextContinuationToken;
    }
    return objects;
  }

  async deleteKey(storageKey) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }
}

export { defaultMaximumPdfBytes };
