import type {
  AdminApiErrorBody,
  AdminIdentity,
  AuditEvent,
  ForumAnnotation,
  ForumTagAppeal,
  GovernanceDirectory,
  ModelPolicy,
  RetrievalSource,
  StorageQuota,
  VisualizationAuditRow,
  VisualizationEntitlement,
  VisualizationProviderRoute,
  VisualizationQuotaPolicy,
  VisualizationUsageRow
} from "./types";

type AdminApiClientInput = {
  accessToken: string;
  cloudUrl: string;
  fetchImpl?: typeof fetch;
  forumUrl: string;
};

export class AdminApiError extends Error {
  code: string;
  status: number;
  traceId?: string;

  constructor(status: number, payload: AdminApiErrorBody) {
    super(payload.message ?? payload.code ?? payload.error ?? `admin_request_failed:${status}`);
    this.code = payload.code ?? payload.error ?? "admin_request_failed";
    this.status = status;
    this.traceId = payload.traceId;
  }
}

function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function safeFileName(header: string | null) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return "support-document.pdf";
    }
  }
  return "support-document.pdf";
}

export function createAdminApiClient({
  accessToken,
  cloudUrl,
  fetchImpl = fetch,
  forumUrl
}: AdminApiClientInput) {
  async function request<T>(baseUrl: string, path: string, init: RequestInit = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as AdminApiErrorBody;
      throw new AdminApiError(response.status, payload);
    }
    return response.json() as Promise<T>;
  }

  function cloudGet<T>(path: string) {
    return request<T>(cloudUrl, path, { cache: "no-store", method: "GET" });
  }

  function cloudPost<T>(path: string, body: Record<string, unknown>) {
    return request<T>(cloudUrl, path, { body: JSON.stringify(body), method: "POST" });
  }

  return {
    accountStatus(input: { reason: string; status: "active" | "disabled" | "deleted"; subjectId: string }) {
      return cloudPost<{ account: { status: string; subjectId: string } }>("/v1/admin/accounts/status", {
        ...input,
        idempotencyKey: idempotencyKey("account-status")
      });
    },
    audit(input: { action?: string; before?: string; limit?: number } = {}) {
      return cloudPost<{ events: AuditEvent[]; nextBefore: string | null }>("/v1/admin/audit/list", input);
    },
    downloadSupportDocument(input: { documentId: string; grantId: string }) {
      return fetchImpl(`${cloudUrl}/v1/admin/support/documents/download`, {
        body: JSON.stringify(input),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      }).then(async (response) => {
        if (!response.ok) {
          throw new AdminApiError(
            response.status,
            await response.json().catch(() => ({})) as AdminApiErrorBody
          );
        }
        return {
          blob: await response.blob(),
          fileName: safeFileName(response.headers.get("content-disposition"))
        };
      });
    },
    forumAnnotations() {
      return request<{ annotations: ForumAnnotation[] }>(forumUrl, "/v1/admin/annotations", {
        cache: "no-store",
        method: "GET"
      });
    },
    forumTagAppeals(status: ForumTagAppeal["status"] = "pending") {
      return request<{ appeals: ForumTagAppeal[] }>(forumUrl, `/v1/admin/annotation-tag-appeals?status=${status}`, {
        cache: "no-store",
        method: "GET"
      });
    },
    grantRole(input: { reason: string; role: "platform_admin" | "developer_diagnostics"; subjectId: string }) {
      return cloudPost<{ grant: { grantId: string } }>("/v1/admin/roles/grant", {
        ...input,
        idempotencyKey: idempotencyKey("grant-role")
      });
    },
    grantSupport(input: {
      documentId: string;
      durationMinutes: number;
      granteeSubject: string;
      reason: string;
      scopeId: string;
      scopeType: "user" | "organization";
    }) {
      return cloudPost<{ grant: { expiresAt: string; grantId: string } }>("/v1/admin/support-access/grant", {
        ...input,
        idempotencyKey: idempotencyKey("grant-support")
      });
    },
    identity() {
      return cloudGet<AdminIdentity>("/v1/admin/me");
    },
    governance() {
      return cloudGet<GovernanceDirectory>("/v1/admin/governance");
    },
    modelPolicy() {
      return cloudGet<ModelPolicy>("/v1/admin/model-policy");
    },
    moderateForumAnnotation(input: { action: "restore" | "withdraw"; annotationId: string; reason: string }) {
      return request<{ action: string; annotationId: string; ok: boolean }>(
        forumUrl,
        `/v1/admin/annotations/${encodeURIComponent(input.annotationId)}/moderate`,
        {
          body: JSON.stringify({ action: input.action, reason: input.reason }),
          method: "POST"
        }
      );
    },
    resolveForumTagAppeal(input: { appealId: string; decision: "accepted" | "rejected"; reason: string }) {
      return request<{ appealId: string; decision: string; resolvedAt: string }>(
        forumUrl,
        `/v1/admin/annotation-tag-appeals/${encodeURIComponent(input.appealId)}/resolve`,
        { body: JSON.stringify({ decision: input.decision, reason: input.reason }), method: "POST" }
      );
    },
    quota(input: { scopeId: string; scopeType: "user" | "organization" }) {
      return cloudPost<{ quota: StorageQuota }>("/v1/admin/quotas/get", input);
    },
    removeRetrievalSource(input: { expectedRevision: number; reason: string; sourceId: string }) {
      return cloudPost<{ removed: true; sourceId: string }>("/v1/admin/retrieval-sources/remove", {
        ...input,
        idempotencyKey: idempotencyKey("remove-source")
      });
    },
    retrievalSources() {
      return cloudGet<{ sources: RetrievalSource[] }>("/v1/admin/retrieval-sources");
    },
    revokeRole(input: { grantId: string; reason: string }) {
      return cloudPost<{ grantId: string; revoked: true }>("/v1/admin/roles/revoke", {
        ...input,
        idempotencyKey: idempotencyKey("revoke-role")
      });
    },
    revokeSupport(input: { grantId: string; reason: string }) {
      return cloudPost<{ grantId: string; revoked: true }>("/v1/admin/support-access/revoke", {
        ...input,
        idempotencyKey: idempotencyKey("revoke-support")
      });
    },
    saveModelPolicy(input: {
      cloudProxyEndpoint: string;
      defaultProvider: string;
      expectedRevision: number;
      reason: string;
    }) {
      return cloudPost<{ policy: ModelPolicy }>("/v1/admin/model-policy/set", {
        ...input,
        idempotencyKey: idempotencyKey("set-model-policy")
      });
    },
    saveQuota(input: {
      expectedRevision: number;
      limitBytes: number;
      reason: string;
      scopeId: string;
      scopeType: "user" | "organization";
    }) {
      return cloudPost<{ quota: StorageQuota }>("/v1/admin/quotas/set", {
        ...input,
        idempotencyKey: idempotencyKey("set-quota")
      });
    },
    saveRetrievalSource(input: {
      baseUrl: string;
      connectorType: "crossref" | "openalex" | "semantic_scholar";
      enabled: boolean;
      expectedRevision: number;
      name: string;
      reason: string;
      sourceId?: string;
      sourceKind: "website" | "database";
    }) {
      return cloudPost<{ source: RetrievalSource }>("/v1/admin/retrieval-sources/save", {
        ...input,
        idempotencyKey: idempotencyKey("save-source")
      });
    },
    setOrganizationStatus(input: {
      expectedRevision: number;
      organizationId: string;
      reason: string;
      status: "active" | "suspended";
    }) {
      return cloudPost<{ organization: GovernanceDirectory["organizations"][number] }>(
        "/v1/admin/organizations/status",
        { ...input, idempotencyKey: idempotencyKey("organization-status") }
      );
    },
    getVisualizationEntitlement(input: { subjectId: string }) {
      return cloudPost<{ entitlement: VisualizationEntitlement }>(
        "/v1/admin/visualization/entitlements/get",
        input
      );
    },
    listVisualizationAudit(input: { action?: string; from?: string; limit?: number; subjectId?: string; to?: string } = {}) {
      const params = new URLSearchParams();
      if (input.action) params.set("action", input.action);
      if (input.from) params.set("from", input.from);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.subjectId) params.set("subjectId", input.subjectId);
      if (input.to) params.set("to", input.to);
      return cloudGet<{ rows: VisualizationAuditRow[] }>(
        `/v1/admin/visualization/audit${params.size ? `?${params.toString()}` : ""}`
      );
    },
    listVisualizationProviderRoutes() {
      return cloudGet<{ routes: VisualizationProviderRoute[] }>("/v1/admin/visualization/providers");
    },
    listVisualizationQuotaPolicies(input: { limit?: number; subjectId?: string } = {}) {
      const params = new URLSearchParams();
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.subjectId) params.set("subjectId", input.subjectId);
      return cloudGet<{ policies: VisualizationQuotaPolicy[] }>(
        `/v1/admin/visualization/quota-policies${params.size ? `?${params.toString()}` : ""}`
      );
    },
    listVisualizationUsage(input: { limit?: number; subjectId?: string } = {}) {
      const params = new URLSearchParams();
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.subjectId) params.set("subjectId", input.subjectId);
      return cloudGet<{ rows: VisualizationUsageRow[] }>(
        `/v1/admin/visualization/usage${params.size ? `?${params.toString()}` : ""}`
      );
    },
    saveVisualizationProviderRoute(input: {
      expectedRevision: number;
      reason: string;
      route: VisualizationProviderRoute;
    }) {
      return cloudPost<{ route: VisualizationProviderRoute }>(
        "/v1/admin/visualization/providers/save",
        { ...input, idempotencyKey: idempotencyKey("save-visualization-provider") }
      );
    },
    setVisualizationEntitlement(input: {
      allowed: boolean;
      allowedModalities: VisualizationEntitlement["allowedModalities"];
      expectedRevision: number;
      explicitRequestsAllowed: boolean;
      reason: string;
      subjectId: string;
    }) {
      return cloudPost<{ entitlement: VisualizationEntitlement }>(
        "/v1/admin/visualization/entitlements/set",
        { ...input, idempotencyKey: idempotencyKey("set-visualization-entitlement") }
      );
    },
    setVisualizationQuotaPolicy(input: {
      dailyUnits: number;
      expectedRevision: number;
      maxConcurrency: number;
      monthlyUnits: number;
      reason: string;
      subjectId: string;
      timezone: string;
    }) {
      return cloudPost<{ policy: VisualizationQuotaPolicy }>(
        "/v1/admin/visualization/quota-policies/set",
        { ...input, idempotencyKey: idempotencyKey("set-visualization-quota-policy") }
      );
    },
    testVisualizationProviderRoute(input: {
      expectedRevision: number;
      providerRequest: Record<string, unknown>;
      reason: string;
    }) {
      return cloudPost<Record<string, unknown>>("/v1/admin/visualization/providers/test", {
        ...input,
        idempotencyKey: idempotencyKey("test-visualization-provider")
      });
    }
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
