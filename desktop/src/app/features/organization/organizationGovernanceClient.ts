import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { OrganizationGovernanceInput, OrganizationGovernanceSummary } from "./organization.types";

export type OrganizationGovernanceTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type OrganizationGovernanceTransport = (
  request: OrganizationGovernanceTransportRequest
) => Promise<ModelTransportResponse>;

type CreateOrganizationGovernanceClientInput = {
  endpoint: string;
  transport?: OrganizationGovernanceTransport;
};

type OrganizationGovernancePayload = {
  summary: OrganizationGovernanceSummary;
};

function buildOrganizationGovernanceUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/org/governance-summary`;
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

function isGovernancePayload(payload: unknown): payload is OrganizationGovernancePayload {
  if (!isRecord(payload) || !isRecord(payload.summary)) {
    return false;
  }

  const summary = payload.summary;
  if (!isRecord(summary.auditQueue) || !isRecord(summary.quota)) {
    return false;
  }

  return (
    hasNumberField(summary.auditQueue, "highRisk") &&
    hasNumberField(summary.auditQueue, "pendingReview") &&
    hasNumberField(summary.quota, "modelCallsLimit") &&
    hasNumberField(summary.quota, "modelCallsUsed") &&
    hasNumberField(summary.quota, "storageLimitGb") &&
    hasNumberField(summary.quota, "storageUsedGb") &&
    Array.isArray(summary.recentAuditEvents) &&
    summary.recentAuditEvents.every(
      (event) =>
        isRecord(event) &&
        hasStringField(event, "id") &&
        hasStringField(event, "label") &&
        hasStringField(event, "risk")
    ) &&
    Array.isArray(summary.runningTasks) &&
    summary.runningTasks.every(
      (task) =>
        isRecord(task) &&
        hasStringField(task, "id") &&
        hasStringField(task, "label") &&
        hasStringField(task, "status")
    )
  );
}

async function defaultTransport(
  request: OrganizationGovernanceTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createOrganizationGovernanceClient({
  endpoint,
  transport = defaultTransport
}: CreateOrganizationGovernanceClientInput) {
  return async (input: OrganizationGovernanceInput): Promise<OrganizationGovernanceSummary> => {
    const response = await transport({
      body: JSON.stringify({
        organizationId: input.organizationId,
        sessionId: input.sessionId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildOrganizationGovernanceUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`组织治理摘要加载失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isGovernancePayload(payload)) {
      throw new Error("组织治理摘要返回格式无效");
    }

    return payload.summary;
  };
}
