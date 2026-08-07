export type AdminSession = {
  accessToken: string;
  expiresAt: string;
  mode: "oauth";
  subjectId: string;
};

export type PlatformRoleGrant = {
  activatedAt: string | null;
  bootstrap: boolean;
  grantId: string;
  grantedAt: string;
  grantedBy: string;
  reason: string;
  role: "platform_admin" | "developer_diagnostics";
  state: string;
  subjectId: string;
};

export type SupportGrant = {
  documentId: string;
  expiresAt: string;
  grantId: string;
  grantedAt: string;
  grantedBy: string;
  granteeSubject: string;
  reason: string;
  revokedAt: string | null;
  scopeId: string;
  scopeType: "user" | "organization";
};

export type OrganizationGovernance = {
  createdAt: string;
  limitBytes: number | null;
  memberCount: number;
  name: string;
  organizationId: string;
  ownerSubject: string;
  revision: number;
  status: "active" | "suspended" | "deleted";
  updatedAt: string;
  usedBytes: number;
};

export type AccountStatusProjection = {
  identityUpdatedAt: string;
  reason: string;
  status: "active" | "disabled" | "deleted";
  subjectId: string;
  updatedAt: string;
  updatedBy: string;
};

export type GovernanceDirectory = {
  accountStatuses: AccountStatusProjection[];
  organizations: OrganizationGovernance[];
  roleGrants: PlatformRoleGrant[];
  supportGrants: SupportGrant[];
};

export type AdminPrincipal = {
  grants: PlatformRoleGrant[];
  roles: string[];
  subjectId: string;
};

export type AdminIdentity = {
  authentication: {
    fresh: boolean;
    methods: string[];
  };
  principal: AdminPrincipal;
};

export type StorageQuota = {
  configured: boolean;
  limitBytes: number | null;
  revision: number;
  scopeId: string;
  scopeType: "user" | "organization";
  updatedAt: string | null;
  updatedBy: string | null;
  usedBytes: number;
};

export type ModelPolicy = {
  cloudProxyEndpoint: string;
  defaultProvider: string;
  policyVersion: string;
  revision: number;
  syncedAt: string;
  updatedBy: string;
};

export type RetrievalSource = {
  baseUrl: string;
  connectorType: "crossref" | "openalex" | "semantic_scholar" | null;
  enabled: boolean;
  name: string;
  revision: number;
  sourceId: string;
  sourceKind: "website" | "database";
  updatedAt: string;
  updatedBy: string;
};

export type AuditEvent = {
  action: string;
  actorAudience: string;
  actorId: string;
  auditId: string;
  detail: Record<string, unknown>;
  occurredAt: string;
  reason: string | null;
  resourceId: string | null;
  resourceType: string;
  scopeId: string | null;
  scopeType: string | null;
  traceId: string;
};

export type ForumAnnotation = {
  authorId: string;
  authorName: string;
  body: string;
  id: string;
  parentAnnotationId: string | null;
  updatedAt: string;
  visibility: "private" | "organization" | "mutual_followers" | "public";
  withdrawnAt: string | null;
};

export type ForumTagAppeal = {
  annotationBody: string;
  annotationId: string;
  appealId: string;
  authorName: string;
  createdAt: string;
  reason: string;
  resolutionReason: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  status: "pending" | "accepted" | "rejected";
  submittedBy: string;
  tag: string;
};

export type AdminApiErrorBody = {
  code?: string;
  error?: string;
  message?: string;
  traceId?: string;
};
