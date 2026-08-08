import type { ModelTransportResponse } from "../models/modelHttpClient";
import { readCloudServiceError } from "../network/cloudErrorMessage";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function role(value: unknown): OrganizationRole | null {
  if (value === "owner" || value === "admin" || value === "member") return value;
  if (value === "管理员") return "admin";
  if (value === "研究员" || value === "审核员" || value === "访客") return "member";
  return null;
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function defaultTransport(request: OrganizationListTransportRequest): Promise<ModelTransportResponse> {
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
      body: JSON.stringify({ sessionId: input.sessionId }),
      headers: {
        Authorization: `Bearer ${input.sessionId}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      url: `${endpoint.replace(/\/+$/, "")}/v1/org/list`
    });
    if (!response.ok) {
      throw await readCloudServiceError(response, {
        code: "organization_list_failed",
        message: "组织列表加载失败，请稍后重试。"
      });
    }
    const payload = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.organizations)) {
      throw new Error("组织列表返回格式无效");
    }
    const organizations = payload.organizations.map((value) => {
      if (!isRecord(value)) throw new Error("组织列表返回格式无效");
      const myRole = role(value.myRole);
      const organizationId = string(value.organizationId);
      const name = string(value.name);
      if (!myRole || !organizationId || !name) throw new Error("组织列表返回格式无效");
      return {
        ...(typeof value.canCreateOrganization === "boolean"
          ? { canCreateOrganization: value.canCreateOrganization }
          : {}),
        memberCount: number(value.memberCount),
        myRole,
        name,
        ...(string(value.ownerUserId) ? { ownerUserId: string(value.ownerUserId) } : {}),
        ...(string(value.ownerSubject) ? { ownerSubject: string(value.ownerSubject) } : {}),
        organizationId,
        revision: number(value.revision),
        sharedLibraryName: string(value.sharedLibraryName) ?? `${name} 共享文献库`
      };
    });
    const requestedActive = string(payload.activeOrganizationId);
    return {
      activeOrganizationId: requestedActive && organizations.some(
        (organization) => organization.organizationId === requestedActive
      ) ? requestedActive : organizations[0]?.organizationId ?? "",
      organizations
    };
  };
}
