export function buildOrganizationListPayload(body) {
  const activeOrganizationId =
    typeof body.activeOrganizationId === "string" ? body.activeOrganizationId : "org-demo-1";

  return {
    activeOrganizationId,
    organizations: [
      {
        memberCount: 12,
        myRole: "研究员",
        name: "Liteasy AI Reading Lab",
        organizationId: "org-demo-1",
        sharedLibraryName: "组织共享文献库"
      },
      {
        memberCount: 4,
        myRole: "管理员",
        name: "Liteasy Literature Ops",
        organizationId: "org-demo-2",
        sharedLibraryName: "文献运营共享库"
      }
    ]
  };
}

export function buildOrganizationSummaryPayload(body) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";

  if (organizationId === "org-demo-2") {
    return {
      summary: {
        auditEvents: [
          {
            actor: "Ops Admin",
            description: "新增 QA 目录",
            id: "audit-ops-1",
            occurredAt: "2026-05-14T11:00:00Z"
          }
        ],
        memberCount: 4,
        members: [
          {
            id: "member-ops-1",
            name: "Liteasy Researcher",
            role: "管理员"
          },
          {
            id: "member-ops-2",
            name: "Ops Reviewer",
            role: "审核员"
          }
        ],
        myRole: sessionId === "anonymous" ? "访客" : "管理员",
        name: "Liteasy Literature Ops",
        notifications: [
          {
            id: "ops-notice-1",
            message: "文献运营共享库新增 QA 目录。",
            type: "library_change"
          }
        ],
        organizationId: "org-demo-2",
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
          status: "available"
        },
        taskSummary: {
          failed: 0,
          running: 1
        }
      }
    };
  }

  return {
    summary: {
      auditEvents: [
        {
          actor: "Admin",
          description: "更新共享文献库上传权限",
          id: "audit-1",
          occurredAt: "2026-05-14T10:30:00Z"
        }
      ],
      memberCount: 12,
      members: [
        {
          id: "member-1",
          name: "Liteasy Researcher",
          role: "研究员"
        },
        {
          id: "member-2",
          name: "Admin",
          role: "管理员"
        }
      ],
      myRole: sessionId === "anonymous" ? "访客" : "研究员",
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
        status: "available"
      },
      taskSummary: {
        failed: 1,
        running: 2
      }
    }
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
