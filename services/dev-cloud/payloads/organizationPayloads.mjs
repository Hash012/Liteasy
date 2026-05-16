import {
  createOrganization,
  getOrganizationSummary,
  inviteOrganizationMember,
  joinOrganization,
  leaveOrganization,
  listOrganizations
} from "../db/organizationRepository.mjs";

export function buildOrganizationListPayload(body) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session-1";
  return listOrganizations(sessionId);
}

export function buildOrganizationSummaryPayload(body) {
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session-1";
  return {
    summary: getOrganizationSummary(organizationId, sessionId)
  };
}

export function buildOrganizationSharedLibraryManifestPayload(body = {}) {
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";

  if (organizationId === "org-demo-2") {
    return {
      manifest: {
        documents: [
          {
            folderId: "org-demo-2-ops",
            id: "org-ops-doc-1",
            sourcePath: "org://org-demo-2/shared-library/Ops/org-ops-doc-1.pdf",
            title: "Organization Ops Handbook"
          }
        ],
        folders: [
          {
            id: "org-demo-2-root",
            name: "文献运营共享库",
            parentId: null,
            path: "org://org-demo-2/shared-library"
          },
          {
            id: "org-demo-2-ops",
            name: "Ops",
            parentId: "org-demo-2-root",
            path: "org://org-demo-2/shared-library/Ops"
          }
        ],
        name: "文献运营共享库",
        organizationId: "org-demo-2",
        rootFolderId: "org-demo-2-root",
        status: "available"
      }
    };
  }

  return {
    manifest: {
      documents: [
        {
          folderId: "org-demo-1-rag",
          id: "org-doc-1",
          sourcePath: "org://org-demo-1/shared-library/RAG/org-doc-1.pdf",
          title: "Organization Reading List: Retrieval-Augmented Generation"
        },
        {
          folderId: "org-demo-1-eval",
          id: "org-doc-2",
          sourcePath: "org://org-demo-1/shared-library/Evaluation/org-doc-2.pdf",
          title: "Team Notes on Long-Context Evaluation"
        }
      ],
      folders: [
        {
          id: "org-demo-1-root",
          name: "组织共享文献库",
          parentId: null,
          path: "org://org-demo-1/shared-library"
        },
        {
          id: "org-demo-1-rag",
          name: "RAG",
          parentId: "org-demo-1-root",
          path: "org://org-demo-1/shared-library/RAG"
        },
        {
          id: "org-demo-1-eval",
          name: "Evaluation",
          parentId: "org-demo-1-root",
          path: "org://org-demo-1/shared-library/Evaluation"
        }
      ],
      name: "组织共享文献库",
      organizationId: "org-demo-1",
      rootFolderId: "org-demo-1-root",
      status: "available"
    }
  };
}

export function buildOrganizationGovernancePayload(body = {}) {
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";

  if (organizationId === "org-demo-2") {
    return {
      summary: {
        auditQueue: {
          highRisk: 0,
          pendingReview: 1
        },
        quota: {
          modelCallsLimit: 5000,
          modelCallsUsed: 900,
          storageLimitGb: 50,
          storageUsedGb: 12
        },
        recentAuditEvents: [
          {
            id: "audit-ops-1",
            label: "Ops Admin 新增 QA 目录",
            risk: "low"
          }
        ],
        runningTasks: [
          {
            id: "task-ops-1",
            label: "文献运营共享库目录同步",
            status: "running"
          }
        ]
      }
    };
  }

  return {
    summary: {
      auditQueue: {
        highRisk: 1,
        pendingReview: 3
      },
      quota: {
        modelCallsLimit: 10000,
        modelCallsUsed: 4200,
        storageLimitGb: 100,
        storageUsedGb: 38
      },
      recentAuditEvents: [
        {
          id: "audit-1",
          label: "Admin 更新共享文献库上传权限",
          risk: "medium"
        }
      ],
      runningTasks: [
        {
          id: "task-1",
          label: "组织共享文献库索引刷新",
          status: "running"
        }
      ]
    }
  };
}

export function buildOrganizationCreatePayload(body = {}) {
  const name = typeof body.name === "string" ? body.name : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session-1";
  if (name.length === 0) {
    return {
      error: "invalid_organization_name"
    };
  }

  return createOrganization(name, sessionId);
}

export function buildOrganizationJoinPayload(body = {}) {
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session-1";
  if (organizationId.length === 0) {
    return {
      error: "invalid_organization_join"
    };
  }

  return joinOrganization(organizationId, sessionId);
}

export function buildOrganizationInvitePayload(body = {}) {
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "";
  const role = typeof body.role === "string" ? body.role : "member";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session-1";
  const targetUserId =
    typeof body.targetUserId === "string" ? body.targetUserId : "";
  if (organizationId.length === 0 || targetUserId.length === 0) {
    return {
      error: "invalid_organization_invite"
    };
  }

  return inviteOrganizationMember(organizationId, role, sessionId, targetUserId);
}

export function buildOrganizationLeavePayload(body = {}) {
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "";
  const role = typeof body.role === "string" ? body.role : "member";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session-1";
  if (organizationId.length === 0) {
    return {
      error: "invalid_organization_leave"
    };
  }

  return leaveOrganization(organizationId, role, sessionId);
}
