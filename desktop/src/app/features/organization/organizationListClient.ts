import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { OrganizationList, OrganizationListInput, OrganizationRole } from "./organization.types";

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

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return value === "owner" || value === "admin" || value === "member";
}

function normalizeOrganizationRole(value: unknown): OrganizationRole | null {
  if (value === "owner" || value === "admin" || value === "member") {
    return value;
  }

  if (value === "管理员") {
    return "admin";
  }

  if (value === "研究员" || value === "审核员" || value === "访客") {
    return "member";
  }

  return null;
}

function isCompatibleOrganizationRole(value: unknown) {
  return normalizeOrganizationRole(value) !== null;
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
        isCompatibleOrganizationRole(organization.myRole) &&
        hasStringField(organization, "name") &&
        hasStringField(organization, "organizationId") &&
        hasStringField(organization, "sharedLibraryName") &&
        (typeof organization.canCreateOrganization === "boolean" || typeof organization.canCreateOrganization === "undefined") &&
        (typeof organization.ownerUserId === "string" || typeof organization.ownerUserId === "undefined")
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

    return {
      activeOrganizationId: payload.activeOrganizationId,
      organizations: payload.organizations.map((organization) => ({
        ...organization,
        myRole: normalizeOrganizationRole(organization.myRole) ?? "member"
      }))
    };
  };
}
