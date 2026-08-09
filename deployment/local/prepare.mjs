import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { localDefaults, localEnvPath, readLocalEnvironment } from "./config.mjs";

const secret = () => randomBytes(32).toString("hex");
const existing = readLocalEnvironment({ required: false });
const keycloakHostPort = existing.KEYCLOAK_HOST_PORT ?? localDefaults.KEYCLOAK_HOST_PORT;
const keycloakPublicUrl = existing.KEYCLOAK_PUBLIC_URL ?? `http://localhost:${keycloakHostPort}`;
const values = {
  ...localDefaults,
  KEYCLOAK_PUBLIC_URL: keycloakPublicUrl,
  KEYCLOAK_ISSUER: `${keycloakPublicUrl.replace(/\/$/, "")}/realms/liteasy`,
  LITEASY_DB_ADMIN_PASSWORD: secret(),
  LITEASY_DB_APP_PASSWORD: secret(),
  LITEASY_DB_MIGRATOR_PASSWORD: secret(),
  INTUECHO_DB_ADMIN_PASSWORD: secret(),
  INTUECHO_DB_APP_PASSWORD: secret(),
  INTUECHO_DB_MIGRATOR_PASSWORD: secret(),
  KEYCLOAK_DB_PASSWORD: secret(),
  KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: `local-admin-${randomBytes(6).toString("hex")}`,
  KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD: secret(),
  LITEASY_CLOUD_CLIENT_SECRET: secret(),
  INTUECHO_API_CLIENT_SECRET: secret(),
  LITEASY_IDENTITY_MANAGEMENT_CLIENT_SECRET: secret(),
  LITEASY_IDENTITY_INTROSPECTION_CLIENT_SECRET: secret(),
  LITEASY_IDENTITY_ADMIN_CLIENT_SECRET: secret(),
  INTUECHO_ORGANIZATION_SERVICE_SECRET: secret(),
  LITEASY_VISUALIZATION_SERVICE_CLIENT_SECRET: secret()
};
const missing = Object.entries(values).filter(([name]) => !Object.hasOwn(existing, name));
if (missing.length === 0) {
  fs.chmodSync(localEnvPath, 0o600);
  process.stdout.write(`${localEnvPath} is complete; existing values were left unchanged.\n`);
  process.exit(0);
}
const payload = missing.map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
if (fs.existsSync(localEnvPath)) {
  fs.appendFileSync(localEnvPath, payload, { encoding: "utf8", mode: 0o600 });
} else {
  fs.writeFileSync(localEnvPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
fs.chmodSync(localEnvPath, 0o600);
process.stdout.write(`Prepared ${localEnvPath} with mode 0600; added ${missing.length} missing keys without changing existing values. No product account was created.\n`);
