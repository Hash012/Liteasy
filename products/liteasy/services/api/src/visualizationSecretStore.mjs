const secretReferencePattern = /^viz-secret:[a-z0-9._-]{1,80}$/;
const secretEnvironmentVariable = "LITEASY_VISUALIZATION_SECRETS_JSON";

export function validateVisualizationSecretRef(secretRef) {
  if (typeof secretRef !== "string" || !secretReferencePattern.test(secretRef)) {
    throw new Error("visualization_secret_ref_invalid");
  }
  return secretRef;
}

export function parseVisualizationSecrets(value) {
  if (value === undefined || value === "") return Object.freeze({});
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`cloud_config_invalid: ${secretEnvironmentVariable} must be a JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`cloud_config_invalid: ${secretEnvironmentVariable} must be a JSON object`);
  }
  const secrets = {};
  for (const [secretRef, secret] of Object.entries(parsed)) {
    try {
      validateVisualizationSecretRef(secretRef);
    } catch {
      throw new Error(`cloud_config_invalid: ${secretEnvironmentVariable} contains an invalid secret reference`);
    }
    if (typeof secret !== "string" || secret.length < 1 || secret.length > 4096) {
      throw new Error(`cloud_config_invalid: ${secretEnvironmentVariable} contains an invalid secret value`);
    }
    secrets[secretRef] = secret;
  }
  return Object.freeze(secrets);
}

export class EnvironmentVisualizationSecretStore {
  constructor(environment = process.env) {
    this.secrets = parseVisualizationSecrets(environment[secretEnvironmentVariable]);
  }

  resolve(secretRef) {
    const reference = validateVisualizationSecretRef(secretRef);
    const secret = this.secrets[reference];
    if (typeof secret !== "string") throw new Error("visualization_secret_not_found");
    return secret;
  }
}
