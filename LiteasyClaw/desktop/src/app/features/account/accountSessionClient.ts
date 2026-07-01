import type { ModelTransportResponse } from "../models/modelHttpClient";
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

type CreateAccountSessionClientInput = {
  endpoint: string;
  transport?: AccountTransport;
};

export type AccountRegistrationInput = {
  displayName: string;
  email: string;
  password: string;
};

type AccountRegistrationClientInput = AccountRegistrationInput & {
  endpoint: string;
  transport?: AccountTransport;
};

type AccountSessionPayload = {
  session: AccountSession;
};

function buildAccountUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/demo-login`;
}

function buildAccountRegistrationUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/register`;
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
    membershipTier: payload.session.membershipTier === "basic" ? "basic" : "pro"
  };
}

async function defaultTransport(request: AccountTransportRequest): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createAccountSessionClient({
  endpoint,
  transport = defaultTransport
}: CreateAccountSessionClientInput) {
  return async (): Promise<AccountSession> => {
    const response = await transport({
      body: JSON.stringify({
        mode: "demo_login"
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildAccountUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`云账号登录失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isAccountSessionPayload(payload)) {
      throw new Error("云账号登录返回格式无效");
    }

    return normalizeAccountSession(payload);
  };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string" &&
    payload.message.length > 0
  ) {
    return payload.message;
  }

  return fallback;
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

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `云账号注册失败（${response.status}）`));
  }

  if (!isAccountSessionPayload(payload)) {
    throw new Error("云账号注册返回格式无效");
  }

  return normalizeAccountSession(payload);
}
