import assert from "node:assert/strict";
import test from "node:test";
import { validateCloudFaultConfig } from "../scripts/cloudFaultGuard.mjs";

const config = { schema: "liteasy.isolated-cloud-fault/v1", disposableTestInstance: true, runId: "0123456789abcdef",
  databaseUrl: "postgres://app:test@127.0.0.1:55444/cloud_fault_test", migrationDatabaseUrl: "postgres://migrator:test@127.0.0.1:55444/cloud_fault_test",
  s3: { endpoint: "http://127.0.0.1:19000", bucket: "liteasy-review-0123456789abcdef", prefix: "review/0123456789abcdef", accessKeyId: "synthetic", secretAccessKey: "synthetic" },
  scanner: { endpoint: "http://127.0.0.1:19001/scan", secret: "synthetic", expectedScanner: "clamav" } };

test("fault injection requires explicit matching isolated resources", () => {
  assert.equal(validateCloudFaultConfig(config).runId, config.runId);
  for (const change of [ { disposableTestInstance: false }, { runId: "anything" },
    { databaseUrl: config.databaseUrl.replace("55444", "5432"), migrationDatabaseUrl: config.migrationDatabaseUrl.replace("55444", "5432") },
    { s3: { ...config.s3, endpoint: "https://production.example:19000" } },
    { s3: { ...config.s3, prefix: "documents" } }, { s3: { ...config.s3, bucket: "shared-development" } },
    { scanner: { ...config.scanner, endpoint: "http://localhost:19001/scan" } }
  ]) assert.throws(() => validateCloudFaultConfig({ ...config, ...change }));
});
