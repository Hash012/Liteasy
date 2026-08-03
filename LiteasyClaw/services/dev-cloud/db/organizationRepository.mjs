import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const organizationFilename = "organizations.json";

function readOrganizationState() {
  return readJsonFile(organizationFilename, buildSeedOrganizationState());
}

function buildSeedOrganizationState() {
  return {
    activeOrganizationIdBySession: {},
    nextOrganizationSequence: 1,
    organizations: {
      "org-demo-1": {
        memberCount: 12,
        members: [
          { id: "demo-session-owner", name: "Owner", role: "owner" },
          { id: "demo-session-1", name: "Liteasy Researcher", role: "member" },
          { id: "member-2", name: "Admin", role: "admin" }
        ],
        name: "Liteasy AI Reading Lab",
        notifications: [
          {
            id: "notice-1",
            message: "管理员发布了本周阅读主题。",
            type: "announcement"
          },
          {
            id: "notice-2",
            message: "成员上传了 Graph Neural Networks 综述。",
            type: "document_upload"
          },
          {
            id: "notice-3",
            message: "共享文献库结构新增 RAG 目录。",
            type: "library_change"
          }
        ],
        organizationId: "org-demo-1",
        ownerUserId: "demo-session-owner",
        quota: {
          periodEndsAt: "2026-06-01T00:00:00Z",
          storageLimitGb: 100,
          storageUsedGb: 38
        },
        sharedLibrary: {
          documentCount: 48,
          documents: [
            {
              id: "org-doc-1",
              sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
              title: "Organization Reading List: Retrieval-Augmented Generation"
            },
            {
              id: "org-doc-2",
              sourcePath: "org://org-demo-1/shared-library/org-doc-2.pdf",
              title: "Team Notes on Long-Context Evaluation"
            }
          ],
          name: "组织共享文献库",
          ownerUserId: "demo-session-owner",
          status: "available"
        },
        sharedLibraryName: "组织共享文献库",
        taskSummary: {
          failed: 1,
          running: 2
        }
      },
      "org-demo-2": {
        memberCount: 4,
        members: [
          { id: "member-ops-1", name: "Liteasy Researcher", role: "admin" },
          { id: "member-ops-2", name: "Ops Reviewer", role: "member" }
        ],
        name: "Liteasy Literature Ops",
        notifications: [
          {
            id: "ops-notice-1",
            message: "文献运营共享库新增 QA 目录。",
            type: "library_change"
          }
        ],
        organizationId: "org-demo-2",
        ownerUserId: "member-ops-1",
        quota: {
          periodEndsAt: "2026-06-01T00:00:00Z",
          storageLimitGb: 50,
          storageUsedGb: 12
        },
        sharedLibrary: {
          documentCount: 16,
          documents: [
            {
              id: "org-ops-doc-1",
              sourcePath: "org://org-demo-2/shared-library/org-ops-doc-1.pdf",
              title: "Organization Ops Handbook"
            }
          ],
          name: "文献运营共享库",
          ownerUserId: "member-ops-1",
          status: "available"
        },
        sharedLibraryName: "文献运营共享库",
        taskSummary: {
          failed: 0,
          running: 1
        }
      }
    }
  };
}

function writeOrganizationState(state) {
  writeJsonFile(organizationFilename, state);
}

function getMemberRole(organization, sessionId) {
  return (
    organization.members.find((member) => member.id === sessionId)?.role ?? "member"
  );
}

export function getOrganizationMemberRole(organizationId, sessionId) {
  const state = readOrganizationState();
  const organization = state.organizations[organizationId];
  return organization?.members.find((member) => member.id === sessionId)?.role ?? null;
}

export function setOrganizationLibraryDocumentVisibility(organizationId, document, visible) {
  const state = readOrganizationState();
  const organization = state.organizations[organizationId];
  if (!organization) return false;
  const documents = organization.sharedLibrary.documents.filter((entry) => entry.id !== document.documentId);
  if (visible) {
    documents.push({
      id: document.documentId,
      sourcePath: `org://${organizationId}/shared-library/${
        document.folderId ? `${document.folderId}/` : ""
      }${document.documentId}.pdf`,
      title: document.fileName.replace(/\.pdf$/i, "")
    });
  }
  organization.sharedLibrary.documents = documents;
  organization.sharedLibrary.documentCount = documents.length;
  writeOrganizationState(state);
  return true;
}

function toOrganizationListItem(organization, sessionId) {
  return {
    canCreateOrganization: sessionId !== "session-basic",
    memberCount: organization.memberCount,
    myRole: getMemberRole(organization, sessionId),
    name: organization.name,
    organizationId: organization.organizationId,
    ownerUserId: organization.ownerUserId,
    sharedLibraryName: organization.sharedLibraryName
  };
}

export function listOrganizations(sessionId) {
  const state = readOrganizationState();
  const organizations = Object.values(state.organizations).map((organization) =>
    toOrganizationListItem(organization, sessionId)
  );

  return {
    activeOrganizationId:
      state.activeOrganizationIdBySession[sessionId] ?? organizations[0]?.organizationId ?? "org-demo-1",
    organizations
  };
}

export function getOrganizationSummary(organizationId, sessionId) {
  const state = readOrganizationState();
  const organization = state.organizations[organizationId] ?? state.organizations["org-demo-1"];

  return {
    auditEvents: [
      {
        actor: "Admin",
        description: "更新共享文献库上传权限",
        id: "audit-1",
        occurredAt: "2026-05-14T10:30:00Z"
      }
    ],
    canCreateOrganization: sessionId !== "session-basic",
    memberCount: organization.memberCount,
    members: organization.members,
    myRole: getMemberRole(organization, sessionId),
    name: organization.name,
    notifications: organization.notifications,
    organizationId: organization.organizationId,
    ownerUserId: organization.ownerUserId,
    quota: organization.quota,
    sharedLibrary: organization.sharedLibrary,
    taskSummary: organization.taskSummary
  };
}

export function createOrganization(name, sessionId) {
  if (sessionId === "session-basic") {
    return {
      error: "organization_create_forbidden"
    };
  }

  const state = readOrganizationState();
  const organizationId = `org-created-${state.nextOrganizationSequence}`;
  state.nextOrganizationSequence += 1;

  state.organizations[organizationId] = {
    memberCount: 1,
    members: [{ id: sessionId, name: "Liteasy Researcher", role: "owner" }],
    name,
    notifications: [],
    organizationId,
    ownerUserId: sessionId,
    quota: {
      periodEndsAt: "2026-06-01T00:00:00Z",
      storageLimitGb: 20,
      storageUsedGb: 0
    },
    sharedLibrary: {
      documentCount: 0,
      documents: [],
      name: `${name} 共享文献库`,
      ownerUserId: sessionId,
      status: "available"
    },
    sharedLibraryName: `${name} 共享文献库`,
    taskSummary: {
      failed: 0,
      running: 0
    }
  };
  state.activeOrganizationIdBySession[sessionId] = organizationId;
  writeOrganizationState(state);

  return {
    organization: {
      myRole: "owner",
      name,
      organizationId,
      ownerUserId: sessionId
    }
  };
}

export function joinOrganization(organizationId, sessionId) {
  const state = readOrganizationState();
  const organization = state.organizations[organizationId];

  if (!organization) {
    return {
      error: "organization_not_found"
    };
  }

  if (!organization.members.some((member) => member.id === sessionId)) {
    organization.members.push({
      id: sessionId,
      name: `Member ${sessionId}`,
      role: "member"
    });
    organization.memberCount = organization.members.length;
  }

  state.activeOrganizationIdBySession[sessionId] = organizationId;
  writeOrganizationState(state);

  return {
    membership: {
      organizationId,
      role: "member",
      sessionId
    }
  };
}

export function inviteOrganizationMember(organizationId, role, sessionId, targetUserId) {
  if (role === "member") {
    return {
      error: "organization_role_forbidden"
    };
  }

  const state = readOrganizationState();
  const organization = state.organizations[organizationId];
  if (!organization) {
    return {
      error: "organization_not_found"
    };
  }

  writeOrganizationState(state);

  return {
    invite: {
      organizationId,
      role,
      sessionId,
      targetUserId
    }
  };
}

export function leaveOrganization(organizationId, role, sessionId) {
  if (role === "owner") {
    return {
      error: "organization_owner_leave_blocked"
    };
  }

  const state = readOrganizationState();
  const organization = state.organizations[organizationId];
  if (!organization) {
    return {
      error: "organization_not_found"
    };
  }

  organization.members = organization.members.filter((member) => member.id !== sessionId);
  organization.memberCount = organization.members.length;
  writeOrganizationState(state);

  return {
    left: true,
    organizationId,
    sessionId
  };
}

export function resetOrganizationData() {
  writeOrganizationState({
    activeOrganizationIdBySession: {},
    nextOrganizationSequence: 1,
    organizations: {}
  });
  return {
    reset: true
  };
}

export function reseedOrganizationData() {
  const nextState = buildSeedOrganizationState();
  writeOrganizationState(nextState);
  return nextState;
}
