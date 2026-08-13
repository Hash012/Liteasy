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

export type AccountDirectoryEntry = {
  accountType: "person" | "service";
  createdAt: string;
  email: string | null;
  emailVerified: boolean;
  enabled: boolean;
  firstName: string | null;
  lastName: string | null;
  platformRoles: Array<"platform_admin" | "developer_diagnostics">;
  projectedStatus: { status: "active" | "disabled" | "deleted"; updatedAt: string } | null;
  subjectId: string;
  username: string;
};

export type AccountDirectoryPage = {
  accounts: AccountDirectoryEntry[];
  first: number;
  max: number;
  search: string;
  total: number;
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

export type MarketingApplication = {
  applicationId: string;
  email: string;
  field: string;
  installerDownloadedAt: string | null;
  problem: string;
  role: string;
  source: "marketing-site";
  submittedAt: string;
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

export type VisualizationModality =
  | "semantic_graph"
  | "circuit"
  | "physics_diagram"
  | "biology_structure"
  | "geometry_2d"
  | "function_plot"
  | "geometry_3d"
  | "physics_process"
  | "reaction_process"
  | "raster_illustration";

export type VisualizationProviderRoute = {
  circuitFailures: number;
  circuitOpenUntil: string | null;
  circuitState: "closed" | "open" | "half_open";
  dataClasses: string[];
  enabled: boolean;
  endpoint: string;
  maxConcurrency: number;
  modalities: VisualizationModality[];
  model: string;
  operations: Array<"structured_generation" | "image_generation" | "validation">;
  priority: number;
  providerId: string;
  region: string;
  revision: number;
  routeId: string;
  secretRef: string;
  timeoutMs: number;
  updatedAt: string | null;
  updatedBy: string;
};

export type VisualizationProviderRouteMutation = Omit<VisualizationProviderRoute, "updatedAt" | "updatedBy">;

export type VisualizationEntitlement = {
  allowed: boolean;
  explicitRequestsAllowed: boolean;
  allowedModalities: VisualizationModality[];
  revision: number;
};

export type VisualizationQuotaPolicy = {
  dailyUnits: number;
  maxConcurrency: number;
  monthlyUnits: number;
  reason: string;
  revision: number;
  subjectId: string;
  timezone: string;
  updatedAt: string | null;
  updatedBy: string;
};

export type VisualizationUsageRow = {
  createdAt: string | null;
  eventId: string;
  eventType: string;
  idempotencyKey: string;
  reasonCode: string | null;
  reservationId: string | null;
  subjectId: string;
  traceId: string;
  unitsDelta: number;
};

export type VisualizationAuditRow = {
  action: string;
  actorId: string;
  auditId: string;
  detail: Record<string, unknown>;
  occurredAt: string | null;
  reason: string | null;
  resourceId: string | null;
  resourceType: string;
  traceId: string;
};
