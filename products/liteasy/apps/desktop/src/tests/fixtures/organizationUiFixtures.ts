import type { OrganizationList, OrganizationSummary } from "../../app/features/organization/organization.types";
export const organizationUiSummary: OrganizationSummary = {
  organizationId: "research", name: "认知与机器学习研究组", revision: 1, myRole: "member", myMemberRevision: 1, memberCount: 2,
  members: [
    { id: "ada", subject: "ada", name: "Ada Lovelace", role: "owner", status: "active", revision: 1 },
    { id: "alan", subject: "alan", name: "Alan Turing", role: "member", status: "active", revision: 1 }
  ],
  notifications: [{ id: "welcome", type: "announcement", message: "本周讨论：大语言模型的记忆机制与推理。" },
    { id: "papers", type: "document_upload", message: "新增两篇阅读材料，可在共享文献库查看。" }],
  sharedLibrary: { name: "团队共享文献", documentCount: 24, documents: [], status: "available" },
  quota: { configured: true, storageUsedGb: 2.4, storageLimitGb: 10 }, auditEvents: []
};
export const organizationUiList: OrganizationList = {
  activeOrganizationId: "research", organizations: [
    { organizationId: "research", name: organizationUiSummary.name, memberCount: 2, myRole: "member", revision: 1, sharedLibraryName: "团队共享文献" },
    { organizationId: "systems", name: "数据库系统小组", memberCount: 8, myRole: "member", revision: 1, sharedLibraryName: "系统论文" }
  ]
};
