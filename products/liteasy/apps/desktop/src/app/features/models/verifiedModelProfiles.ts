import { validateDirectModelConfig, type DirectModelConfig } from "./modelProviders";
import type { UpdateSettingCommand } from "../settings/settings.types";

export const verifiedModelProfilesKey = "liteasy.verified-models.v1";
export const verifiedModelProfilesEvent = "liteasy:verified-models-changed";
export type VerifiedModelProfile = { id: string; config: DirectModelConfig; verifiedAt: string };
let volatileProfiles: VerifiedModelProfile[] | undefined;

function cleanConfig(input: DirectModelConfig): DirectModelConfig {
  const { provider, endpoint, model, protocol, outputFormat } = validateDirectModelConfig(input);
  return { provider, endpoint, model, protocol, outputFormat };
}
export function modelProfileId(input: DirectModelConfig) {
  const c = cleanConfig(input);
  return JSON.stringify([c.provider, c.endpoint, c.model, c.protocol, c.outputFormat]);
}
export function loadVerifiedModelProfiles(): VerifiedModelProfile[] {
  if (volatileProfiles) return volatileProfiles;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(verifiedModelProfilesKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    const profiles = new Map<string, VerifiedModelProfile>();
    for (const entry of value) {
      try {
        if (!entry || typeof entry.verifiedAt !== "string" || !Number.isFinite(Date.parse(entry.verifiedAt))) continue;
        const config = cleanConfig(entry.config);
        const id = modelProfileId(config);
        profiles.set(id, { id, config, verifiedAt: entry.verifiedAt });
      } catch { /* Ignore individual malformed saved entries. */ }
    }
    return [...profiles.values()];
  } catch { return []; }
}
function save(profiles: VerifiedModelProfile[]) {
  try { localStorage.setItem(verifiedModelProfilesKey, JSON.stringify(profiles)); volatileProfiles = undefined; }
  catch { volatileProfiles = profiles; }
  globalThis.dispatchEvent?.(new Event(verifiedModelProfilesEvent));
}
/** Call only after a real, non-empty model response; presets are not access verification. */
export function rememberVerifiedModel(input: DirectModelConfig) {
  const config = cleanConfig(input);
  const id = modelProfileId(config);
  save([...loadVerifiedModelProfiles().filter((profile) => profile.id !== id), { id, config, verifiedAt: new Date().toISOString() }]);
}
export function forgetVerifiedModel(id: string) {
  save(loadVerifiedModelProfiles().filter((profile) => profile.id !== id));
}
/** Credentials are scoped to provider + endpoint, shared across models at that endpoint. */
export function invalidateVerifiedModels(input: DirectModelConfig) {
  const config = cleanConfig(input);
  save(loadVerifiedModelProfiles().filter((profile) => profile.config.provider !== config.provider || profile.config.endpoint !== config.endpoint));
}
export function directModelSettingCommands(config: DirectModelConfig): UpdateSettingCommand[] {
  const c = cleanConfig(config);
  return [
    { intent: "update_setting", target: "models.direct_provider", value: c.provider },
    { intent: "update_setting", target: "models.direct_endpoint", value: c.endpoint },
    { intent: "update_setting", target: "models.direct_model", value: c.model },
    { intent: "update_setting", target: "models.direct_protocol", value: c.protocol },
    { intent: "update_setting", target: "models.direct_output_format", value: c.outputFormat },
    { intent: "update_setting", target: "models.connection_mode", value: "direct" }
  ];
}
