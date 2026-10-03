import { validatePostgresIntegrationDatabases } from "./postgresIntegrationGuard.mjs";

export function validateCloudFaultConfig(value) {
  const deny = () => { throw new Error("isolated_cloud_fault_configuration_required"); };
  const loopback = (address) => {
    try {
      const url = new URL(address);
      return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "[::1]"].includes(url.hostname)
        && Number(url.port) >= 1024 && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  if (value?.schema !== "liteasy.isolated-cloud-fault/v1" || value.disposableTestInstance !== true
    || !/^[a-f0-9]{16}$/.test(value.runId ?? "")) deny();
  const database = validatePostgresIntegrationDatabases(value.databaseUrl, value.migrationDatabaseUrl);
  if (database.application.port === 5432 || !["127.0.0.1", "::1"].includes(database.application.host)) deny();
  if (!loopback(value.s3?.endpoint) || !loopback(value.scanner?.endpoint)
    || value.s3.bucket !== `liteasy-review-${value.runId}` || value.s3.prefix !== `review/${value.runId}`
    || typeof value.s3.accessKeyId !== "string" || !value.s3.accessKeyId
    || typeof value.s3.secretAccessKey !== "string" || !value.s3.secretAccessKey
    || typeof value.scanner.secret !== "string" || !value.scanner.secret
    || !/^[A-Za-z0-9._-]{1,40}$/.test(value.scanner.expectedScanner ?? "")) deny();
  return { ...value, database };
}
