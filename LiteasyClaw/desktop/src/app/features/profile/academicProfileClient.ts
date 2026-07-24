import type { AccountSession } from "../account/account.types";
import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { AcademicProfile } from "./profile.types";

export type PersonalizationSignal =
  | { kind: "paper_opened" | "recommendation_saved"; title: string }
  | { kind: "recommendation_dismissed"; recommendationId: string };

export type AcademicProfileSnapshot = {
  assistantSummary?: string;
  personalizationVersion: number;
  profile: AcademicProfile & { profileVersion: number };
};

export type AcademicProfileTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type AcademicProfileTransport = (
  request: AcademicProfileTransportRequest
) => Promise<ModelTransportResponse>;

type CreateAcademicProfileClientInput = {
  endpoint: string;
  transport?: AcademicProfileTransport;
};

function isAcademicDiscipline(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "categoryCode" in value &&
    typeof value.categoryCode === "string" &&
    "categoryName" in value &&
    typeof value.categoryName === "string" &&
    "code" in value &&
    typeof value.code === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function isSnapshot(value: unknown): value is AcademicProfileSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "personalizationVersion" in value &&
    typeof value.personalizationVersion === "number" &&
    "profile" in value &&
    typeof value.profile === "object" &&
    value.profile !== null &&
    "disciplines" in value.profile &&
    Array.isArray(value.profile.disciplines) &&
    value.profile.disciplines.every(isAcademicDiscipline) &&
    "stage" in value.profile &&
    typeof value.profile.stage === "string" &&
    "profileVersion" in value.profile &&
    typeof value.profile.profileVersion === "number" &&
    (!("assistantSummary" in value) || typeof value.assistantSummary === "string")
  );
}

async function defaultTransport(
  request: AcademicProfileTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

function buildUrl(endpoint: string, action: "get" | "save" | "clear" | "signal") {
  return `${endpoint.replace(/\/+$/, "")}/v1/${
    action === "signal" ? "personalization/signal" : `profile/${action}`
  }`;
}

export function createAcademicProfileClient({
  endpoint,
  transport = defaultTransport
}: CreateAcademicProfileClientInput) {
  async function request(
    action: "get" | "save" | "clear" | "signal",
    body: Record<string, unknown>
  ): Promise<AcademicProfileSnapshot> {
    const response = await transport({
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildUrl(endpoint, action)
    });
    if (!response.ok) {
      throw new Error(`学术档案同步失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isSnapshot(payload)) {
      throw new Error("学术档案返回格式无效");
    }
    return payload;
  }

  return {
    clear(session: AccountSession) {
      return request("clear", { sessionId: session.sessionId });
    },
    get(session: AccountSession) {
      return request("get", { sessionId: session.sessionId });
    },
    recordSignal(session: AccountSession, signal: PersonalizationSignal) {
      return request("signal", { sessionId: session.sessionId, signal });
    },
    save(session: AccountSession, profile: AcademicProfile) {
      return request("save", { profile, sessionId: session.sessionId });
    }
  };
}
