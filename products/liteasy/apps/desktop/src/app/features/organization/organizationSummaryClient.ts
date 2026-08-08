import type { ModelTransportResponse } from "../models/modelHttpClient";
import { readCloudServiceError } from "../network/cloudErrorMessage";
import type {
  OrganizationAuditEvent,
  OrganizationMember,
  OrganizationNotification,
  OrganizationRole,
  OrganizationSummary,
  OrganizationSummaryInput
} from "./organization.types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function role(value: unknown): OrganizationRole | null {
  if (value === "owner" || value === "admin" || value === "member") return value;
  if (value === "管理员") return "admin";
  if (value === "研究员" || value === "审核员" || value === "访客") return "member";
  return null;
}

function members(value: unknown): OrganizationMember[] {
  if (!Array.isArray(value)) throw new Error("组织空间返回格式无效");
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("组织空间返回格式无效");
    const memberRole = role(item.role);
    const subject = string(item.subject) ?? string(item.id);
    if (!memberRole || !subject) throw new Error("组织空间返回格式无效");
    return {
      id: string(item.id) ?? subject,
      name: string(item.name) ?? subject,
      revision: number(item.revision),
      role: memberRole,
      status: item.status === "suspended" ? "suspended" : "active",
      subject
    };
  });
}

function auditEvents(value: unknown): OrganizationAuditEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = string(item.id) ?? string(item.auditId);
    const actor = string(item.actor) ?? string(item.actorSubject);
    const description = string(item.description) ?? string(item.action);
    const occurredAt = string(item.occurredAt);
    return id && actor && description && occurredAt ? [{ actor, description, id, occurredAt }] : [];
  });
}

function notifications(value: unknown): OrganizationNotification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = string(item.id);
    const message = string(item.message);
    const type = item.type;
    return id && message && (type === "announcement" || type === "document_upload" || type === "library_change")
      ? [{ id, message, type }]
      : [];
  });
}

function normalizeSummary(value: unknown): OrganizationSummary {
  if (!isRecord(value) || !isRecord(value.quota) || !isRecord(value.sharedLibrary)) {
    throw new Error("组织空间返回格式无效");
  }
  const myRole = role(value.myRole);
  const name = string(value.name);
  const organizationId = string(value.organizationId);
  const sharedLibraryName = string(value.sharedLibrary.name);
  if (!myRole || !name || !organizationId || !sharedLibraryName ||
    !Array.isArray(value.sharedLibrary.documents)) {
    throw new Error("组织空间返回格式无效");
  }
  const sharedDocuments = value.sharedLibrary.documents.map((document) => {
    if (!isRecord(document)) throw new Error("组织空间返回格式无效");
    const id = string(document.id);
    const sourcePath = string(document.sourcePath);
    const title = string(document.title);
    if (!id || !sourcePath || !title) throw new Error("组织空间返回格式无效");
    return { id, sourcePath, title };
  });
  const formalQuota = "usedBytes" in value.quota || "limitBytes" in value.quota;
  const configured = formalQuota ? value.quota.configured === true : true;
  const storageLimitGb = formalQuota
    ? number(value.quota.limitBytes) / (1024 ** 3)
    : number(value.quota.storageLimitGb);
  const storageUsedGb = formalQuota
    ? number(value.quota.usedBytes) / (1024 ** 3)
    : number(value.quota.storageUsedGb);
  const taskSummary = isRecord(value.taskSummary)
    ? { failed: number(value.taskSummary.failed), running: number(value.taskSummary.running) }
    : undefined;
  const policy: OrganizationSummary["policy"] = isRecord(value.policy) &&
    (value.policy.uploadPolicy === "owner_admins" || value.policy.uploadPolicy === "all_members") &&
    (value.policy.exportPolicy === "disabled" || value.policy.exportPolicy === "admins_only" ||
      value.policy.exportPolicy === "all_members")
    ? {
      exportPolicy: value.policy.exportPolicy,
      uploadPolicy: value.policy.uploadPolicy
    }
    : undefined;
  return {
    auditEvents: auditEvents(value.auditEvents),
    ...(typeof value.canCreateOrganization === "boolean"
      ? { canCreateOrganization: value.canCreateOrganization }
      : {}),
    memberCount: number(value.memberCount),
    members: members(value.members),
    myMemberRevision: typeof value.myMemberRevision === "number" ? value.myMemberRevision : null,
    myRole,
    name,
    notifications: notifications(value.notifications),
    ...(string(value.ownerUserId) ? { ownerUserId: string(value.ownerUserId) } : {}),
    organizationId,
    ...(policy ? { policy } : {}),
    quota: {
      configured,
      ...(string(value.quota.periodEndsAt) ? { periodEndsAt: string(value.quota.periodEndsAt) } : {}),
      storageLimitGb,
      storageUsedGb
    },
    revision: number(value.revision),
    sharedLibrary: {
      documentCount: number(value.sharedLibrary.documentCount, sharedDocuments.length),
      documents: sharedDocuments,
      name: sharedLibraryName,
      status: value.sharedLibrary.status === "syncing" || value.sharedLibrary.status === "unavailable"
        ? value.sharedLibrary.status
        : "available"
    },
    ...(taskSummary ? { taskSummary } : {})
  };
}

async function defaultTransport(request: OrganizationSummaryTransportRequest): Promise<ModelTransportResponse> {
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
        Authorization: `Bearer ${input.sessionId}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      url: `${endpoint.replace(/\/+$/, "")}/v1/org/summary`
    });
    if (!response.ok) {
      throw await readCloudServiceError(response, {
        code: "organization_summary_failed",
        message: "组织空间加载失败，请稍后重试。"
      });
    }
    const payload = await response.json();
    if (!isRecord(payload) || !("summary" in payload)) throw new Error("组织空间返回格式无效");
    return normalizeSummary(payload.summary);
  };
}
