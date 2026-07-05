import type { SettingsState } from "../settings/settings.types";
import {
  createAccountSessionClient,
  loginCloudAccount,
  logoutCloudAccount,
  registerCloudAccount,
  validateCloudAccountSession,
  type AccountLoginInput,
  type AccountRegistrationInput,
  type AccountTransport
} from "./accountSessionClient";
import type { AccountSession } from "./account.types";

type AccountSessionRuntimeDeps = {
  transport?: AccountTransport;
};

const mockAccountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

export async function createCloudAccountSession(
  settings: SettingsState,
  deps: AccountSessionRuntimeDeps = {}
) {
  const endpoint = settings["models.control_plane_endpoint"];
  if (isMockEndpoint(endpoint)) {
    return mockAccountSession;
  }

  const client = createAccountSessionClient({
    endpoint,
    transport: deps.transport
  });

  return client();
}

export async function createRegisteredCloudAccountSession(
  settings: SettingsState,
  registration: AccountRegistrationInput,
  deps: AccountSessionRuntimeDeps = {}
) {
  const endpoint = settings["models.control_plane_endpoint"];

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
  return loginCloudAccount({
    ...login,
    endpoint: settings["models.control_plane_endpoint"],
    transport: deps.transport
  });
}

export async function validateStoredCloudAccountSession(
  settings: SettingsState,
  sessionId: string,
  deps: AccountSessionRuntimeDeps = {}
) {
  if (isMockEndpoint(settings["models.control_plane_endpoint"])) {
    return mockAccountSession;
  }

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
  if (isMockEndpoint(settings["models.control_plane_endpoint"])) {
    return;
  }

  await logoutCloudAccount({
    endpoint: settings["models.control_plane_endpoint"],
    sessionId,
    transport: deps.transport
  });
}
