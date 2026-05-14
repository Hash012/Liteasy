import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { OrganizationList, OrganizationListInput } from "./organization.types";

export type OrganizationListTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type OrganizationListTransport = (
  request: OrganizationListTransportRequest
) => Promise<ModelTransportResponse>;

type CreateOrganizationListClientInput = {
  endpoint: string;
  transport?: OrganizationListTransport;
};

function buildOrganizationListUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/org/list`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasStringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === "string";
}

function hasNumberField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === "number";
}

function isOrganizationListPayload(payload: unknown): payload is OrganizationList {
  return (
    isRecord(payload) &&
    hasStringField(payload, "activeOrganizationId") &&
    Array.isArray(payload.organizations) &&
    payload.organizations.every(
      (organization) =>
        isRecord(organization) &&
        hasNumberField(organization, "memberCount") &&
        hasStringField(organization, "myRole") &&
        hasStringField(organization, "name") &&
        hasStringField(organization, "organizationId") &&
        hasStringField(organization, "sharedLibraryName")
    )
  );
}

async function defaultTransport(
  request: OrganizationListTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createOrganizationListClient({
  endpoint,
  transport = defaultTransport
}: CreateOrganizationListClientInput) {
  return async (input: OrganizationListInput): Promise<OrganizationList> => {
    const response = await transport({
      body: JSON.stringify({
        sessionId: input.sessionId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildOrganizationListUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`组织列表加载失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isOrganizationListPayload(payload)) {
      throw new Error("组织列表返回格式无效");
    }

    return payload;
  };
}
