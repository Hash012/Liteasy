import type { SettingsState } from "../settings/settings.types";
import {
  loginCloudAccount,
  logoutCloudAccount,
  registerCloudAccount,
  validateCloudAccountSession,
  type AccountLoginInput,
  type AccountRegistrationInput,
  type AccountTransport
} from "./accountSessionClient";
import { isLoopbackAccountEndpoint } from "./desktopIdentityClient";

type AccountSessionRuntimeDeps = {
  transport?: AccountTransport;
};

export async function createRegisteredCloudAccountSession(
  settings: SettingsState,
  registration: AccountRegistrationInput,
  deps: AccountSessionRuntimeDeps = {}
) {
  const endpoint = settings["models.control_plane_endpoint"];
  if (!isLoopbackAccountEndpoint(endpoint)) {
    throw new Error("development_account_endpoint_required");
  }

  return registerCloudAccount({
    ...registration,
    endpoint,
    transport: deps.transport
  });
}

export async function createAuthenticatedCloudAccountSession(
  settings: SettingsState,
  login: AccountLoginInput,
  deps: AccountSessionRuntimeDeps = {}
) {
  const endpoint = settings["models.control_plane_endpoint"];
  if (!isLoopbackAccountEndpoint(endpoint)) {
    throw new Error("development_account_endpoint_required");
  }
  return loginCloudAccount({
    ...login,
    endpoint,
    transport: deps.transport
  });
}

export async function validateStoredCloudAccountSession(
  settings: SettingsState,
  sessionId: string,
  deps: AccountSessionRuntimeDeps = {}
) {
  return validateCloudAccountSession({
    endpoint: settings["models.control_plane_endpoint"],
    sessionId,
    transport: deps.transport
  });
}

export async function revokeCloudAccountSession(
  settings: SettingsState,
  sessionId: string,
  deps: AccountSessionRuntimeDeps = {}
) {
  await logoutCloudAccount({
    endpoint: settings["models.control_plane_endpoint"],
    sessionId,
    transport: deps.transport
  });
}
