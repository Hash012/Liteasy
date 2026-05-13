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

type AccountSessionPayload = {
  session: AccountSession;
};

function buildAccountUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/account/demo-login`;
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

    return payload.session;
  };
}
