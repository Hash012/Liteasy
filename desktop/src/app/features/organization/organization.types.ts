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

export type OrganizationMember = {
  id: string;
  name: string;
  role: string;
};

export type OrganizationQuota = {
  periodEndsAt: string;
  storageLimitGb: number;
  storageUsedGb: number;
};

export type OrganizationSharedLibraryStatus = "available" | "syncing" | "unavailable";

export type OrganizationSharedLibraryDocument = {
  id: string;
  sourcePath: string;
  title: string;
};

export type OrganizationSharedLibrary = {
  documentCount: number;
  documents: OrganizationSharedLibraryDocument[];
  name: string;
  status: OrganizationSharedLibraryStatus;
};

export type OrganizationTaskSummary = {
  failed: number;
  running: number;
};

export type OrganizationSummary = {
  auditEvents: OrganizationAuditEvent[];
  memberCount: number;
  members: OrganizationMember[];
  myRole: string;
  name: string;
  notifications: OrganizationNotification[];
  organizationId: string;
  quota: OrganizationQuota;
  sharedLibrary: OrganizationSharedLibrary;
  taskSummary: OrganizationTaskSummary;
};

export type OrganizationListItem = {
  memberCount: number;
  myRole: string;
  name: string;
  organizationId: string;
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

export type OrganizationSummaryStatus = "unauthenticated" | "loading" | "success" | "error";

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

export type OrganizationGovernanceStatus = "unauthenticated" | "loading" | "success" | "error";
