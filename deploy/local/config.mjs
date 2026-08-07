import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const localRoot = path.dirname(fileURLToPath(import.meta.url));
export const localEnvPath = path.join(localRoot, ".env");

export const localDefaults = Object.freeze({
  POSTGRES_IMAGE: "postgres:16",
  KEYCLOAK_IMAGE: "quay.io/keycloak/keycloak:26.3.2",
  IDENTITY_MANAGEMENT_IMAGE: "liteasy/identity-management:local",
  LOCAL_BIND_ADDRESS: "127.0.0.1",
  LOCAL_RUNTIME_HOST: "127.0.0.1",
  LITEASY_DB_HOST_PORT: "55432",
  INTUECHO_DB_HOST_PORT: "55433",
  KEYCLOAK_HOST_PORT: "18081",
  IDENTITY_MANAGEMENT_HOST_PORT: "9090",
  KEYCLOAK_PUBLIC_URL: "http://localhost:18081",
  KEYCLOAK_ISSUER: "http://localhost:18081/realms/liteasy",
  KEYCLOAK_INTERNAL_URL: "http://keycloak:8080",
  LITEASY_DESKTOP_LOOPBACK_REDIRECT_URI: "http://127.0.0.1:*/*",
  LITEASY_DESKTOP_LOCALHOST_REDIRECT_URI: "http://localhost:*/*",
  LITEASY_DESKTOP_WEB_ORIGIN: "http://tauri.localhost",
  INTUECHO_WEB_LOOPBACK_REDIRECT_URI: "http://127.0.0.1:*/*",
  INTUECHO_WEB_REDIRECT_URI: "http://localhost:*/*",
  INTUECHO_WEB_LOOPBACK_ORIGIN: "http://127.0.0.1:*",
  INTUECHO_WEB_ORIGIN: "http://localhost:*",
  LITEASY_ADMIN_LOOPBACK_REDIRECT_URI: "http://127.0.0.1:*/*",
  LITEASY_ADMIN_REDIRECT_URI: "http://localhost:*/*",
  LITEASY_ADMIN_LOOPBACK_ORIGIN: "http://127.0.0.1:*",
  LITEASY_ADMIN_WEB_ORIGIN: "http://localhost:*"
});

export function parseEnvironmentFile(contents, source = "environment file") {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`${source} contains an invalid line`);
    const name = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || Object.hasOwn(values, name)) {
      throw new Error(`${source} contains an invalid or duplicate key`);
    }
    values[name] = line.slice(separator + 1);
  }
  return values;
}

export function readLocalEnvironment({ required = true } = {}) {
  if (!fs.existsSync(localEnvPath)) {
    if (required) throw new Error("deploy/local/.env is missing; run node deploy/local/prepare.mjs");
    return {};
  }
  return parseEnvironmentFile(fs.readFileSync(localEnvPath, "utf8"), "deploy/local/.env");
}

export function resolvedLocalEnvironment(values = readLocalEnvironment()) {
  return Object.freeze({ ...localDefaults, ...values });
}

export function localPort(values, name) {
  const port = Number(values[name]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`deploy/local/.env contains an invalid ${name}`);
  }
  return port;
}

export function localUrl(values, name) {
  let url;
  try {
    url = new URL(values[name]);
  } catch {
    throw new Error(`deploy/local/.env contains an invalid ${name}`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`deploy/local/.env contains an invalid ${name}`);
  }
  return url.toString().replace(/\/$/, "");
}
