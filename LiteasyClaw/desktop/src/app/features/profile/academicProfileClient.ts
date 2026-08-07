import type { AccountSession } from "../account/account.types";
import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { AcademicProfile } from "./profile.types";

export type PersonalizationSignal =
  | { kind: "paper_opened" | "recommendation_saved"; title: string; workId?: string }
  | { kind: "recommendation_dismissed"; recommendationId: string };

export type UserTag = {
  evidenceCount: number;
  label: string;
  signalSource?: string;
  tagId?: string;
  weight: number;
};

export type AcademicProfileSnapshot = {
  assistantSummary?: string;
  enabled?: boolean;
  personalizationVersion: number;
  profile: Pick<AcademicProfile, "disciplines" | "stage"> & { profileVersion: number };
  tags?: UserTag[];
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

function isUserTag(value: unknown): value is UserTag {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string" &&
    "weight" in value &&
    typeof value.weight === "number" &&
    "evidenceCount" in value &&
    typeof value.evidenceCount === "number" &&
    (!("signalSource" in value) || value.signalSource === undefined || typeof value.signalSource === "string") &&
    (!("tagId" in value) || value.tagId === undefined || typeof value.tagId === "string")
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
    (!("assistantSummary" in value) || typeof value.assistantSummary === "string") &&
    (!("enabled" in value) || typeof value.enabled === "boolean") &&
    (!("tags" in value) ||
      value.tags === undefined ||
      (Array.isArray(value.tags) && value.tags.every(isUserTag)))
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

function buildUrl(endpoint: string, action: "get" | "save" | "clear" | "signal" | "settings") {
  return `${endpoint.replace(/\/+$/, "")}/v1/${
    action === "signal"
      ? "personalization/signal"
      : action === "settings"
        ? "personalization/settings/update"
        : `profile/${action}`
  }`;
}

function createIdempotencyKey() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? `personalization:${globalThis.crypto.randomUUID()}`
    : `personalization:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function createAcademicProfileClient({
  endpoint,
  transport = defaultTransport
}: CreateAcademicProfileClientInput) {
  async function request(
    action: "get" | "save" | "clear" | "signal" | "settings",
    session: AccountSession,
    body: Record<string, unknown>
  ): Promise<AcademicProfileSnapshot> {
    const response = await transport({
      body: JSON.stringify({ ...body, sessionId: session.sessionId }),
      headers: {
        Authorization: `Bearer ${session.sessionId}`,
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
    clear(session: AccountSession, expectedVersion: number) {
      return request("clear", session, {
        expectedVersion,
        idempotencyKey: createIdempotencyKey()
      });
    },
    get(session: AccountSession) {
      return request("get", session, {});
    },
    recordSignal(session: AccountSession, signal: PersonalizationSignal) {
      return request("signal", session, { idempotencyKey: createIdempotencyKey(), signal });
    },
    save(
      session: AccountSession,
      profile: Pick<AcademicProfile, "disciplines" | "stage">,
      expectedVersion: number
    ) {
      return request("save", session, {
        expectedVersion,
        idempotencyKey: createIdempotencyKey(),
        profile
      });
    },
    setEnabled(session: AccountSession, enabled: boolean, expectedVersion: number) {
      return request("settings", session, {
        enabled,
        expectedVersion,
        idempotencyKey: createIdempotencyKey()
      });
    }
  };
}
