import type { ModelTransportResponse } from "../models/modelHttpClient";
import { readCloudServiceError } from "../network/cloudErrorMessage";
import type { OrganizationRole } from "./organization.types";

export type OrganizationActionTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type OrganizationActionTransport = (
  request: OrganizationActionTransportRequest
) => Promise<ModelTransportResponse>;

type OrganizationActionClientInput = {
  endpoint: string;
  transport?: OrganizationActionTransport;
};

type SessionInput = {
  displayName: string;
  sessionId: string;
};

function idempotencyKey(operation: string) {
  const unique = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return `organization:${operation}:${unique}`;
}

async function defaultTransport(request: OrganizationActionTransportRequest): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

async function responseError(response: ModelTransportResponse) {
  return readCloudServiceError(response, {
    code: "organization_request_failed",
    message: "组织请求未完成，请稍后重试。"
  });
}

export function createOrganizationActionClient({
  endpoint,
  transport = defaultTransport
}: OrganizationActionClientInput) {
  async function post<T>(path: string, sessionId: string, body: Record<string, unknown>): Promise<T> {
    const response = await transport({
      body: JSON.stringify({ ...body, sessionId }),
      headers: {
        Authorization: `Bearer ${sessionId}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      url: `${endpoint.replace(/\/+$/, "")}/v1/org/${path}`
    });
    if (!response.ok) throw await responseError(response);
    return await response.json() as T;
  }

  return {
    create(input: SessionInput & { name: string }) {
      return post<{ organization: {
        myRole: "owner";
        name: string;
        organizationId: string;
        revision: number;
      } }>("create", input.sessionId, {
        displayName: input.displayName,
        idempotencyKey: idempotencyKey("create"),
        name: input.name
      });
    },

    invite(input: SessionInput & {
      expectedRevision: number;
      organizationId: string;
      role: Extract<OrganizationRole, "admin" | "member">;
      targetSubject: string;
    }) {
      return post<{
        invitation?: {
          invitationToken: string;
          organizationId: string;
          role: string;
          targetSubject: string;
        };
        invite?: { organizationId: string; role: string; targetUserId: string };
        organizationRevision?: number;
      }>("invite", input.sessionId, {
        displayName: input.displayName,
        expectedRevision: input.expectedRevision,
        idempotencyKey: idempotencyKey("invite"),
        organizationId: input.organizationId,
        role: input.role,
        targetSubject: input.targetSubject
      });
    },

    acceptInvitation(input: SessionInput & { invitationToken: string }) {
      return post<{ membership: {
        revision?: number;
        role: OrganizationRole;
        status?: string;
        subject?: string;
      }; organizationId?: string; organizationRevision?: number }>("join", input.sessionId, {
        displayName: input.displayName,
        expectedInvitationRevision: 0,
        idempotencyKey: idempotencyKey("accept-invitation"),
        invitationToken: input.invitationToken
      });
    },

    leave(input: SessionInput & {
      expectedMemberRevision: number;
      expectedRevision: number;
      organizationId: string;
    }) {
      return post<{ left: true; organizationId: string; organizationRevision?: number }>(
        "leave",
        input.sessionId,
        {
          displayName: input.displayName,
          expectedMemberRevision: input.expectedMemberRevision,
          expectedRevision: input.expectedRevision,
          idempotencyKey: idempotencyKey("leave"),
          organizationId: input.organizationId
        }
      );
    },

    changeMemberRole(input: SessionInput & {
      expectedMemberRevision: number;
      expectedRevision: number;
      organizationId: string;
      role: Extract<OrganizationRole, "admin" | "member">;
      targetSubject: string;
    }) {
      return post("members/role", input.sessionId, {
        expectedMemberRevision: input.expectedMemberRevision,
        expectedRevision: input.expectedRevision,
        idempotencyKey: idempotencyKey("member-role"),
        organizationId: input.organizationId,
        role: input.role,
        targetSubject: input.targetSubject
      });
    },

    setMemberStatus(input: SessionInput & {
      expectedMemberRevision: number;
      expectedRevision: number;
      organizationId: string;
      status: "active" | "removed" | "suspended";
      targetSubject: string;
    }) {
      return post("members/status", input.sessionId, {
        expectedMemberRevision: input.expectedMemberRevision,
        expectedRevision: input.expectedRevision,
        idempotencyKey: idempotencyKey("member-status"),
        organizationId: input.organizationId,
        status: input.status,
        targetSubject: input.targetSubject
      });
    },

    transferOwnership(input: SessionInput & {
      expectedMemberRevision: number;
      expectedRevision: number;
      organizationId: string;
      targetSubject: string;
    }) {
      return post("owner/transfer", input.sessionId, {
        expectedMemberRevision: input.expectedMemberRevision,
        expectedRevision: input.expectedRevision,
        idempotencyKey: idempotencyKey("owner-transfer"),
        organizationId: input.organizationId,
        targetSubject: input.targetSubject
      });
    }
  };
}

export type OrganizationActionClient = ReturnType<typeof createOrganizationActionClient>;
