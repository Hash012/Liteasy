import type { ModelTransportResponse } from "../models/modelHttpClient";
import { readCloudServiceError } from "../network/cloudErrorMessage";
import type { AccountSession } from "./account.types";

export type AccountTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type AccountTransport = (
  request: AccountTransportRequest
) => Promise<ModelTransportResponse>;

export type AccountRegistrationInput = {
  displayName: string;
  email: string;
  password: string;
};

export type AccountLoginInput = {
  email: string;
  password: string;
};

type AccountRegistrationClientInput = AccountRegistrationInput & {
  endpoint: string;
  transport?: AccountTransport;
};

type AccountLoginClientInput = AccountLoginInput & {
  endpoint: string;
  transport?: AccountTransport;
};

type AccountSessionPayload = {
  session: AccountSession;
};

function buildAccountRegistrationUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/register`;
}

function buildAccountLoginUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/login`;
}

function buildAccountSessionUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/session`;
}

function buildAccountLogoutUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/logout`;
}

function isAccountSessionPayload(payload: unknown): payload is AccountSessionPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "session" in payload &&
    typeof payload.session === "object" &&
    payload.session !== null &&
    "email" in payload.session &&
    typeof payload.session.email === "string" &&
    "expiresAt" in payload.session &&
    typeof payload.session.expiresAt === "string" &&
    "name" in payload.session &&
    typeof payload.session.name === "string" &&
    "sessionId" in payload.session &&
    typeof payload.session.sessionId === "string"
  );
}

function normalizeAccountSession(payload: AccountSessionPayload): AccountSession {
  return {
    ...payload.session,
    membershipTier: payload.session.membershipTier === "pro" ? "pro" : "basic"
  };
}

async function defaultTransport(request: AccountTransportRequest): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export async function registerCloudAccount({
  displayName,
  email,
  endpoint,
  password,
  transport = defaultTransport
}: AccountRegistrationClientInput): Promise<AccountSession> {
  const response = await transport({
    body: JSON.stringify({
      displayName,
      email,
      password
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST",
    url: buildAccountRegistrationUrl(endpoint)
  });

  if (!response.ok) {
    throw await readCloudServiceError(response, {
      code: "account_registration_failed",
      message: "云账号注册失败，请检查输入后重试。"
    });
  }

  const payload = await response.json();
  if (!isAccountSessionPayload(payload)) {
    throw new Error("云账号注册返回格式无效");
  }

  return normalizeAccountSession(payload);
}

export async function loginCloudAccount({
  email,
  endpoint,
  password,
  transport = defaultTransport
}: AccountLoginClientInput): Promise<AccountSession> {
  const response = await transport({
    body: JSON.stringify({ email, password }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST",
    url: buildAccountLoginUrl(endpoint)
  });
  if (!response.ok) {
    throw await readCloudServiceError(response, {
      code: "account_login_failed",
      message: "云账号登录失败，请检查账号信息后重试。"
    });
  }
  const payload = await response.json();
  if (!isAccountSessionPayload(payload)) {
    throw new Error("云账号登录返回格式无效");
  }
  return normalizeAccountSession(payload);
}

export async function validateCloudAccountSession({
  endpoint,
  sessionId,
  transport = defaultTransport
}: {
  endpoint: string;
  sessionId: string;
  transport?: AccountTransport;
}): Promise<AccountSession> {
  const response = await transport({
    body: JSON.stringify({ sessionId }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST",
    url: buildAccountSessionUrl(endpoint)
  });
  if (!response.ok) {
    throw await readCloudServiceError(response, {
      code: "account_session_invalid",
      message: "云账号会话已失效，请重新登录。"
    });
  }
  const payload = await response.json();
  if (!isAccountSessionPayload(payload)) {
    throw new Error("云账号会话返回格式无效");
  }
  return normalizeAccountSession(payload);
}

export async function logoutCloudAccount({
  endpoint,
  sessionId,
  transport = defaultTransport
}: {
  endpoint: string;
  sessionId: string;
  transport?: AccountTransport;
}): Promise<void> {
  const response = await transport({
    body: JSON.stringify({ sessionId }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST",
    url: buildAccountLogoutUrl(endpoint)
  });

  if (!response.ok) {
    throw await readCloudServiceError(response, {
      code: "account_logout_failed",
      message: "云账号退出未完成，请重试。"
    });
  }
}
