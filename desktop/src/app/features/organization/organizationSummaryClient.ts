import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { OrganizationRole, OrganizationSummary, OrganizationSummaryInput } from "./organization.types";

export type OrganizationSummaryTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type OrganizationSummaryTransport = (
  request: OrganizationSummaryTransportRequest
) => Promise<ModelTransportResponse>;

type CreateOrganizationSummaryClientInput = {
  endpoint: string;
  transport?: OrganizationSummaryTransport;
};

type OrganizationSummaryPayload = {
  summary: OrganizationSummary;
};

function buildOrganizationSummaryUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/org/summary`;
}

function isNotificationType(value: unknown) {
  return value === "announcement" || value === "document_upload" || value === "library_change";
}

function isSharedLibraryStatus(value: unknown) {
  return value === "available" || value === "syncing" || value === "unavailable";
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return value === "owner" || value === "admin" || value === "member";
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

function isOrganizationSummaryPayload(payload: unknown): payload is OrganizationSummaryPayload {
  if (!isRecord(payload) || !isRecord(payload.summary)) {
    return false;
  }

  const summary = payload.summary;
  if (!isRecord(summary.quota) || !isRecord(summary.sharedLibrary) || !isRecord(summary.taskSummary)) {
    return false;
  }

  return (
    Array.isArray(summary.auditEvents) &&
    summary.auditEvents.every(
      (event) =>
        isRecord(event) &&
        hasStringField(event, "actor") &&
        hasStringField(event, "description") &&
        hasStringField(event, "id") &&
        hasStringField(event, "occurredAt")
    ) &&
    hasNumberField(summary, "memberCount") &&
    Array.isArray(summary.members) &&
    summary.members.every(
      (member) =>
        isRecord(member) &&
        hasStringField(member, "id") &&
        hasStringField(member, "name") &&
        isOrganizationRole(member.role)
    ) &&
    isOrganizationRole(summary.myRole) &&
    hasStringField(summary, "name") &&
    Array.isArray(summary.notifications) &&
    summary.notifications.every(
      (notification) =>
        isRecord(notification) &&
        hasStringField(notification, "id") &&
        hasStringField(notification, "message") &&
        isNotificationType(notification.type)
    ) &&
    hasStringField(summary, "organizationId") &&
    (typeof summary.canCreateOrganization === "boolean" || typeof summary.canCreateOrganization === "undefined") &&
    (typeof summary.ownerUserId === "string" || typeof summary.ownerUserId === "undefined") &&
    hasStringField(summary.quota, "periodEndsAt") &&
    hasNumberField(summary.quota, "storageLimitGb") &&
    hasNumberField(summary.quota, "storageUsedGb") &&
    hasNumberField(summary.sharedLibrary, "documentCount") &&
    Array.isArray(summary.sharedLibrary.documents) &&
    summary.sharedLibrary.documents.every(
      (document) =>
        isRecord(document) &&
        hasStringField(document, "id") &&
        hasStringField(document, "sourcePath") &&
        hasStringField(document, "title")
    ) &&
    hasStringField(summary.sharedLibrary, "name") &&
    (typeof summary.sharedLibrary.ownerUserId === "string" ||
      typeof summary.sharedLibrary.ownerUserId === "undefined") &&
    isSharedLibraryStatus(summary.sharedLibrary.status) &&
    hasNumberField(summary.taskSummary, "failed") &&
    hasNumberField(summary.taskSummary, "running")
  );
}

async function defaultTransport(
  request: OrganizationSummaryTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createOrganizationSummaryClient({
  endpoint,
  transport = defaultTransport
}: CreateOrganizationSummaryClientInput) {
  return async (input: OrganizationSummaryInput): Promise<OrganizationSummary> => {
    const response = await transport({
      body: JSON.stringify({
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        sessionId: input.sessionId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildOrganizationSummaryUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`组织空间加载失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isOrganizationSummaryPayload(payload)) {
      throw new Error("组织空间返回格式无效");
    }

    return payload.summary;
  };
}
