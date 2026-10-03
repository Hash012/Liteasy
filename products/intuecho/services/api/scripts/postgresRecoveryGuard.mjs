import path from "node:path";
import { validateIntuechoPostgresIntegrationDatabase } from "./postgresIntegrationGuard.mjs";

function forbidden() {
  throw new Error("intuecho_recovery_test_configuration_forbidden");
}

// No environment/default database fallback: creating test databases requires an
// explicit disposable-instance declaration and a separate marked control DB.
export function validateIntuechoRecoveryTestConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) forbidden();
  const allowed = new Set(["schema", "disposableTestInstance", "adminDatabaseUrl", "expectedSystemIdentifier",
    "binaryDirectory", "libraryDirectory", "evidenceDirectory"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schema !== "liteasy.postgres-recovery-test/v1" || value.disposableTestInstance !== true ||
    !/^[0-9]{16,24}$/.test(value.expectedSystemIdentifier ?? "")) forbidden();
  let admin;
  try { admin = validateIntuechoPostgresIntegrationDatabase(value.adminDatabaseUrl); }
  catch { forbidden(); }
  if (!new Set(["127.0.0.1", "::1"]).has(admin.host) ||
    !new URL(value.adminDatabaseUrl).port || admin.port === 5432 ||
    !Number.isInteger(admin.port) || admin.port < 1024 || admin.port > 65535 ||
    !/^account_recovery_control_[a-z0-9]{6,32}_test$/.test(admin.database) ||
    !/^recovery_test_admin_[a-z0-9]{6,32}$/.test(admin.user)) forbidden();
  for (const field of ["binaryDirectory", "evidenceDirectory"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field])) forbidden();
  }
  if (value.libraryDirectory !== undefined &&
    (typeof value.libraryDirectory !== "string" || !path.isAbsolute(value.libraryDirectory))) forbidden();
  return {
    admin,
    expectedSystemIdentifier: value.expectedSystemIdentifier,
    binaryDirectory: value.binaryDirectory,
    evidenceDirectory: value.evidenceDirectory,
    ...(value.libraryDirectory === undefined ? {} : { libraryDirectory: value.libraryDirectory })
  };
}
