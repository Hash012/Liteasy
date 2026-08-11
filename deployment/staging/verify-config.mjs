import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostKeys = [
  "ADMIN_HOST",
  "API_HOST",
  "AUTH_HOST",
  "COMMUNITY_HOST",
  "IDENTITY_HOST",
  "MARKETING_HOST"
];
const imageKeys = [
  "GATEWAY_IMAGE",
  "IDENTITY_MANAGEMENT_IMAGE",
  "INTUECHO_API_IMAGE",
  "KEYCLOAK_IMAGE",
  "LITEASY_API_IMAGE"
];
const runtimeFileKeys = [
  "GATEWAY_ENV_FILE",
  "IDENTITY_MANAGEMENT_ENV_FILE",
  "INTUECHO_API_ENV_FILE",
  "KEYCLOAK_ENV_FILE",
  "LITEASY_API_ENV_FILE"
];

function required(config, name) {
  const value = config[name]?.trim();
  if (!value) throw new Error(`staging_config_missing:${name}`);
  return value;
}

export function parseEnvFile(content) {
  const result = {};
  for (const [index, source] of String(content).split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`staging_config_invalid_line:${index + 1}`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || Object.hasOwn(result, key)) {
      throw new Error(`staging_config_invalid_key:${index + 1}`);
    }
    result[key] = line.slice(separator + 1).trim();
  }
  return result;
}

export function validateStagingConfig(config) {
  const hosts = hostKeys.map((name) => {
    const hostname = required(config, name).toLowerCase();
    const stagingHostname = hostname === "staging.liteasyclaw.com" || hostname.includes(".staging.");
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+liteasyclaw\.com$/.test(hostname) ||
      !stagingHostname) {
      throw new Error(`staging_config_invalid_host:${name}`);
    }
    return hostname;
  });
  if (new Set(hosts).size !== hosts.length) throw new Error("staging_config_duplicate_host");

  for (const name of imageKeys) {
    const image = required(config, name);
    if (!/^[^\s@]+(?:\/[^\s@]+)*@sha256:[a-f0-9]{64}$/.test(image)) {
      throw new Error(`staging_config_unpinned_image:${name}`);
    }
  }

  const runtimeDirectory = required(config, "STAGING_RUNTIME_DIR");
  const caCertificate = required(config, "RDS_CA_CERT_FILE");
  if (!path.isAbsolute(runtimeDirectory) || !path.isAbsolute(caCertificate) ||
    !/\.(?:crt|pem)$/.test(caCertificate)) {
    throw new Error("staging_config_runtime_path_invalid");
  }
  for (const name of runtimeFileKeys) {
    const file = required(config, name);
    const relative = path.relative(runtimeDirectory, file);
    if (!path.isAbsolute(file) || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`staging_config_runtime_file_invalid:${name}`);
    }
  }

  return Object.freeze({
    hosts: Object.freeze(hosts),
    images: imageKeys.length,
    runtimeDirectory,
    verified: true
  });
}

function main(argv) {
  const configPath = argv[2];
  if (!configPath) throw new Error("usage: node verify-config.mjs /absolute/path/to/config.env");
  const config = parseEnvFile(fs.readFileSync(configPath, "utf8"));
  process.stdout.write(`${JSON.stringify(validateStagingConfig(config))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
