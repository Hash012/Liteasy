import { beforeEach, expect, test, vi } from "vitest";
import { AdminApiError, createAdminApiClient } from "../api";

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
});

test("uses a liteasy-admin bearer token and formal control-plane contracts", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ init, url });
    if (url.endsWith("/v1/admin/me")) {
      return new Response(JSON.stringify({ authentication: { fresh: true, methods: ["mfa"] }, principal: { grants: [], roles: ["platform_admin"], subjectId: "admin-1" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ policy: { revision: 2 } }), { status: 200 });
  });
  const client = createAdminApiClient({
    accessToken: "admin-token",
    cloudUrl: "https://api.liteasy.example",
    fetchImpl,
    forumUrl: "https://forum.liteasy.example"
  });

  await client.identity();
  await client.saveModelPolicy({
    cloudProxyEndpoint: "https://models.liteasy.example",
    defaultProvider: "openai",
    expectedRevision: 1,
    reason: "Approved provider routing update"
  });

  expect(requests[0]).toMatchObject({ url: "https://api.liteasy.example/v1/admin/me" });
  expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer admin-token");
  expect(requests[1].url).toBe("https://api.liteasy.example/v1/admin/model-policy/set");
  expect(JSON.parse(String(requests[1].init?.body))).toEqual(expect.objectContaining({
    expectedRevision: 1,
    idempotencyKey: "set-model-policy:00000000-0000-4000-8000-000000000001"
  }));
});

test("routes annotation moderation to the isolated Intuecho API", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ action: "withdraw", annotationId: "annotation-1", ok: true }), { status: 200 }));
  const client = createAdminApiClient({
    accessToken: "admin-token",
    cloudUrl: "https://api.liteasy.example",
    fetchImpl,
    forumUrl: "https://forum.liteasy.example"
  });

  await client.moderateForumAnnotation({ action: "withdraw", annotationId: "annotation/1", reason: "Confirmed policy violation" });
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://forum.liteasy.example/v1/admin/annotations/annotation%2F1/moderate",
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer admin-token" }),
      method: "POST"
    })
  );
});

test("loads and resolves platform tag appeals through Intuecho governance", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).includes("resolve")
      ? { appealId: "appeal-1", decision: "accepted", resolvedAt: "2026-08-07T00:00:00.000Z" }
      : { appeals: [] }
  ), { status: 200 }));
  const client = createAdminApiClient({
    accessToken: "admin-token",
    cloudUrl: "https://api.liteasy.example",
    fetchImpl,
    forumUrl: "https://forum.liteasy.example"
  });

  await client.forumTagAppeals();
  await client.resolveForumTagAppeal({ appealId: "appeal/1", decision: "accepted", reason: "Confirmed incorrect semantic label" });
  expect(fetchImpl.mock.calls[0][0]).toBe("https://forum.liteasy.example/v1/admin/annotation-tag-appeals?status=pending");
  expect(fetchImpl.mock.calls[1][0]).toBe("https://forum.liteasy.example/v1/admin/annotation-tag-appeals/appeal%2F1/resolve");
});

test("uses revision and idempotency for organization governance mutations", async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
    organization: { organizationId: "organization-1", revision: 4, status: "suspended" }
  }), { status: 200 }));
  const client = createAdminApiClient({
    accessToken: "admin-token",
    cloudUrl: "https://api.liteasy.example",
    fetchImpl,
    forumUrl: "https://forum.liteasy.example"
  });

  await client.setOrganizationStatus({
    expectedRevision: 3,
    organizationId: "organization-1",
    reason: "Approved security response suspension",
    status: "suspended"
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.liteasy.example/v1/admin/organizations/status",
    expect.objectContaining({ method: "POST" })
  );
  expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
    expectedRevision: 3,
    idempotencyKey: "organization-status:00000000-0000-4000-8000-000000000001"
  }));
});

test("preserves stable error codes and trace identifiers", async () => {
  const client = createAdminApiClient({
    accessToken: "expired",
    cloudUrl: "https://api.liteasy.example",
    fetchImpl: async () => new Response(JSON.stringify({
      code: "fresh_mfa_required",
      message: "Authenticate again.",
      traceId: "trace-1"
    }), { status: 403 }),
    forumUrl: "https://forum.liteasy.example"
  });

  const error = await client.identity().catch((value) => value);
  expect(error).toBeInstanceOf(AdminApiError);
  expect(error).toMatchObject({ code: "fresh_mfa_required", status: 403, traceId: "trace-1" });
});

test("uses visualization control-plane routes and idempotency keys", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ init, url: String(input) });
    if (String(input).endsWith("/entitlements/get")) {
      return new Response(JSON.stringify({ entitlement: { allowed: false, explicitRequestsAllowed: false, allowedModalities: [], revision: 3 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ entitlement: { allowed: true, explicitRequestsAllowed: false, allowedModalities: [], revision: 4 } }), { status: 200 });
  });
  const client = createAdminApiClient({
    accessToken: "admin-token",
    cloudUrl: "https://api.liteasy.example",
    fetchImpl,
    forumUrl: "https://forum.liteasy.example"
  });

  await client.getVisualizationEntitlement({ subjectId: "user-1" });
  await client.setVisualizationEntitlement({
    allowed: true,
    allowedModalities: [],
    expectedRevision: 3,
    explicitRequestsAllowed: false,
    reason: "Approved visualization entitlement",
    subjectId: "user-1"
  });
  expect(requests[0].url).toBe("https://api.liteasy.example/v1/admin/visualization/entitlements/get");
  expect(JSON.parse(String(requests[1].init?.body))).toEqual(expect.objectContaining({
    expectedRevision: 3,
    idempotencyKey: "set-visualization-entitlement:00000000-0000-4000-8000-000000000001"
  }));
});
