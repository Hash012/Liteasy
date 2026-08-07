import type { OrganizationStoragePolicy } from "./organizationStoragePolicy";

export type OrganizationNotificationType = "announcement" | "document_upload" | "library_change";

export type OrganizationNotification = {
  id: string;
  message: string;
  type: OrganizationNotificationType;
};

export type OrganizationAuditEvent = {
  actor: string;
  description: string;
  id: string;
  occurredAt: string;
};

export type OrganizationRole = "owner" | "admin" | "member";

export type OrganizationMember = {
  id: string;
  name: string;
  revision: number;
  role: OrganizationRole;
  status: "active" | "suspended";
  subject: string;
};

export type OrganizationQuota = {
  configured: boolean;
  periodEndsAt?: string;
  storageLimitGb: number;
  storageUsedGb: number;
};

export type OrganizationSharedLibraryStatus = "available" | "syncing" | "unavailable";

export type OrganizationSharedLibraryDocument = {
  id: string;
  sourcePath: string;
  title: string;
};

export type OrganizationSharedLibraryFolder = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
};

export type OrganizationSharedLibraryManifestDocument = OrganizationSharedLibraryDocument & {
  folderId: string;
};

export type OrganizationSharedLibraryManifest = {
  documents: OrganizationSharedLibraryManifestDocument[];
  folders: OrganizationSharedLibraryFolder[];
  name: string;
  organizationId: string;
  rootFolderId: string;
  status: OrganizationSharedLibraryStatus;
};

export type OrganizationSharedLibraryManifestInput = {
  organizationId: string;
  sessionId: string;
};

export type OrganizationSharedLibrary = {
  documentCount: number;
  documents: OrganizationSharedLibraryDocument[];
  name: string;
  ownerUserId?: string;
  status: OrganizationSharedLibraryStatus;
};

export type OrganizationTaskSummary = {
  failed: number;
  running: number;
};

export type OrganizationSummary = {
  auditEvents: OrganizationAuditEvent[];
  canCreateOrganization?: boolean;
  memberCount: number;
  members: OrganizationMember[];
  myMemberRevision: number | null;
  myRole: OrganizationRole;
  name: string;
  notifications: OrganizationNotification[];
  ownerUserId?: string;
  organizationId: string;
  policy?: OrganizationStoragePolicy;
  quota: OrganizationQuota;
  revision: number;
  sharedLibrary: OrganizationSharedLibrary;
  taskSummary?: OrganizationTaskSummary;
};

export type OrganizationListItem = {
  canCreateOrganization?: boolean;
  memberCount: number;
  myRole: OrganizationRole;
  name: string;
  ownerUserId?: string;
  ownerSubject?: string;
  organizationId: string;
  revision: number;
  sharedLibraryName: string;
};

export type OrganizationList = {
  activeOrganizationId: string;
  organizations: OrganizationListItem[];
};

export type OrganizationListInput = {
  sessionId: string;
};

export type OrganizationListStatus = "unauthenticated" | "loading" | "success" | "error";

export type OrganizationSummaryInput = {
  organizationId?: string;
  sessionId: string;
};

export type OrganizationSummaryStatus = "unauthenticated" | "idle" | "loading" | "success" | "error";

export type OrganizationGovernanceAuditQueue = {
  highRisk: number;
  pendingReview: number;
};

export type OrganizationGovernanceQuota = {
  modelCallsLimit: number;
  modelCallsUsed: number;
  storageLimitGb: number;
  storageUsedGb: number;
};

export type OrganizationGovernanceAuditEvent = {
  id: string;
  label: string;
  risk: string;
};

export type OrganizationGovernanceTask = {
  id: string;
  label: string;
  status: string;
};

export type OrganizationGovernanceSummary = {
  auditQueue: OrganizationGovernanceAuditQueue;
  quota: OrganizationGovernanceQuota;
  recentAuditEvents: OrganizationGovernanceAuditEvent[];
  runningTasks: OrganizationGovernanceTask[];
};

export type OrganizationGovernanceInput = {
  organizationId: string;
  sessionId: string;
};

export type OrganizationGovernanceStatus = "unauthenticated" | "waiting" | "loading" | "success" | "error";
