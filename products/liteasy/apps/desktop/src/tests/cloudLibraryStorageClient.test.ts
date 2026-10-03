import { vi } from "vitest";
import { storeAccountSession } from "../app/features/account/accountSessionStorage";
import { cacheExternalPdf, readCachedPdf } from "../app/features/library/paperCacheClient";
import { createCloudLibraryStorageClient } from "../app/features/library/cloudLibraryStorageClient";
import { personalLibraryScopeId } from "../app/features/library/LibraryPane";

vi.mock("../app/features/library/paperCacheClient", () => ({
  cacheExternalPdf: vi.fn(async () => "synthetic-cache.pdf"),
  readCachedPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70]))
}));

const confirmedLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/liteasy" }],
  literatureId: "lit_01J00000000000000000000000",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const },
  revision: 1,
  status: "confirmed" as const,
  title: "Cloud Literature Metadata",
  year: 2026
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(cacheExternalPdf).mockClear();
  vi.mocked(readCachedPdf).mockClear();
  storeAccountSession({
    email: "alice@example.com",
    expiresAt: "2026-08-03T00:00:00.000Z",
    membershipTier: "pro",
    name: "Alice",
    sessionId: "ltsy_session",
    userId: "alice"
  });
});

test("sends the verified personal subject unchanged for tree, import and export requests", async () => {
  const subject = "8d337604-f670-440a-8f72-aa057b84137d";
  storeAccountSession({ email: "alice@example.com", expiresAt: "2027-01-01T00:00:00.000Z", membershipTier: "basic", name: "Alice", sessionId: "subject-token", userId: subject });
  const fetchImpl = vi.fn(async (url: string) => url.endsWith("/export")
    ? new Response(new Uint8Array([37, 80, 68, 70]))
    : new Response(JSON.stringify({ tree: { entries: [], folders: [], revision: 0 }, revision: 1 }), { headers: { "content-type": "application/json" } }));
  const client = createCloudLibraryStorageClient({ endpoint: "https://cloud.example.test", fetchImpl: fetchImpl as unknown as typeof fetch });
  const scope = { scopeId: personalLibraryScopeId(subject), scopeType: "user" as const };
  await client.getTree(scope);
  await client.createMetadataEntry({ scope, expectedRevision: 0, title: "My reference" });
  const exported = await client.exportDocument(scope, "my-pdf");
  expect(exported.bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
  for (const [, request] of vi.mocked(fetchImpl as unknown as typeof fetch).mock.calls) {
    expect(JSON.parse(String(request!.body))).toMatchObject({ scopeId: subject, scopeType: "user" });
    expect(request!.headers).toMatchObject({ Authorization: "Bearer subject-token" });
  }
});

test("requires a live authorization request before opening a cloud document", async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error(
    "connect ECONNREFUSED /srv/liteasy/private.sock token=sk-secret"
  ));
  const client = createCloudLibraryStorageClient({
    endpoint: "http://127.0.0.1:8787",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  const opening = client.openDocument(
    { scopeId: "org-1", scopeType: "organization" },
    "document-1"
  );
  await expect(opening).rejects.toMatchObject({
    code: "cloud_library_unavailable",
    message: expect.not.stringContaining("/srv/liteasy"),
    status: 0
  });
  await expect(opening).rejects.toThrow("必须联网重新校验");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toBe(
    "http://127.0.0.1:8787/v1/library/documents/authorize"
  );
});

test("preserves a stable authorization error and trace ID", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    code: "organization_membership_required",
    message: "当前账号不是该组织成员。",
    traceId: "trace_library_auth_1"
  }), {
    headers: { "Content-Type": "application/json" },
    status: 403
  }));
  const client = createCloudLibraryStorageClient({
    endpoint: "https://cloud.example.test",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  await expect(client.openDocument(
    { scopeId: "organization-1", scopeType: "organization" },
    "document-1"
  )).rejects.toMatchObject({
    code: "organization_membership_required",
    message: expect.stringContaining("当前账号不是该组织成员"),
    status: 403,
    traceId: "trace_library_auth_1"
  });
});

test("returns the authorized response stream without buffering the document", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([37, 80, 68, 70, 45]));
      controller.close();
    }
  });
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ allowed: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }))
    .mockResolvedValueOnce(new Response(stream, { status: 200 }));
  const client = createCloudLibraryStorageClient({
    endpoint: "http://127.0.0.1:8787",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  const result = await client.downloadDocumentStream(
    { scopeId: "user:alice", scopeType: "user" },
    "document-1"
  );

  const reader = result.getReader();
  expect((await reader.read()).value).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
  expect((await reader.read()).done).toBe(true);
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
    "http://127.0.0.1:8787/v1/library/documents/authorize",
    "http://127.0.0.1:8787/v1/library/documents/download"
  ]);
  for (const [, init] of fetchImpl.mock.calls) {
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ltsy_session");
  }
});

test("reopens a local request stream when a duplicate is saved as a copy", async () => {
  const duplicate = {
    contentHash: "a".repeat(64),
    duplicates: [{ documentId: "document-1" }],
    status: "duplicate"
  };
  const imported = {
    document: { documentId: "document-2" },
    duplicates: duplicate.duplicates,
    status: "imported"
  };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(duplicate), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify(imported), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }));
  const createBody = vi.fn(async () => new ReadableStream<Uint8Array>());
  const client = createCloudLibraryStorageClient({
    endpoint: "http://127.0.0.1:8787",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  await client.uploadDocumentStream({
    createBody,
    expectedRevision: 1,
    fileName: "Paper.pdf",
    onDuplicate: () => true,
    scope: { scopeId: "user:alice", scopeType: "user" }
  });

  expect(createBody).toHaveBeenCalledTimes(2);
  const retryHeaders = fetchImpl.mock.calls[1][1]?.headers as Record<string, string>;
  expect(retryHeaders.Authorization).toBe("Bearer ltsy_session");
  expect(retryHeaders["X-Liteasy-Duplicate-Action"]).toBe("save_copy");
});

test("an exact duplicate can only be saved as a copy or cancelled", async () => {
  const duplicate = {
    contentHash: "a".repeat(64),
    duplicates: [{ documentId: "document-1" }],
    status: "duplicate"
  };
  const imported = {
    document: { documentId: "document-2", fileName: "Paper (2).pdf" },
    duplicates: duplicate.duplicates,
    status: "imported"
  };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(duplicate), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify(imported), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }));
  const client = createCloudLibraryStorageClient({
    endpoint: "http://127.0.0.1:8787",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  const result = await client.uploadDocument({
    file: new File(["%PDF-1.7"], "Paper.pdf", { type: "application/pdf" }),
    onDuplicate: () => true,
    scope: { scopeId: "user:alice", scopeType: "user" }
  });

  expect(result.status).toBe("imported");
  const secondHeaders = fetchImpl.mock.calls[1][1]?.headers as Record<string, string>;
  expect(secondHeaders["X-Liteasy-Duplicate-Action"]).toBe("save_copy");
  expect(Object.values(secondHeaders)).not.toContain("replace");
});

test("reads and updates organization storage policy with revision and idempotency", async () => {
  const currentPolicy = {
    exportPolicy: "disabled",
    revision: 4,
    role: "owner",
    updatedAt: "2026-08-06T00:00:00.000Z",
    updatedBy: "alice",
    uploadPolicy: "owner_admins"
  };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(currentPolicy), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      ...currentPolicy,
      exportPolicy: "admins_only",
      revision: 5,
      uploadPolicy: "all_members"
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    }));
  const client = createCloudLibraryStorageClient({
    endpoint: "http://127.0.0.1:8787",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  await client.getOrganizationStoragePolicy("organization-1");
  await client.updateOrganizationStoragePolicy({
    expectedRevision: 4,
    exportPolicy: "admins_only",
    organizationId: "organization-1",
    uploadPolicy: "all_members"
  });

  const [readUrl, readInit] = fetchImpl.mock.calls[0];
  expect(readUrl).toBe("http://127.0.0.1:8787/v1/org/storage-policy");
  expect((readInit?.headers as Record<string, string>).Authorization).toBe("Bearer ltsy_session");
  const [updateUrl, updateInit] = fetchImpl.mock.calls[1];
  expect(updateUrl).toBe("http://127.0.0.1:8787/v1/org/storage-policy/update");
  expect((updateInit?.headers as Record<string, string>).Authorization).toBe("Bearer ltsy_session");
  const updateBody = JSON.parse(updateInit?.body as string);
  expect(updateBody).toMatchObject({
    expectedRevision: 4,
    exportPolicy: "admins_only",
    organizationId: "organization-1",
    sessionId: "ltsy_session",
    uploadPolicy: "all_members"
  });
  expect(updateBody.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
});

test("updates cloud literature with revision and idempotency metadata", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    document: { documentId: "document-1", metadata: { literature: confirmedLiterature } },
    revision: 5
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  }));
  const client = createCloudLibraryStorageClient({
    endpoint: "https://cloud.example.test",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  const result = await client.updateLiterature(
    { scopeId: "user:alice", scopeType: "user" },
    "document-1",
    4,
    confirmedLiterature
  );

  expect(result.revision).toBe(5);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe("https://cloud.example.test/v1/library/documents/update");
  const body = JSON.parse(init?.body as string);
  expect(body).toMatchObject({
    documentId: "document-1",
    expectedRevision: 4,
    literature: {
      literatureId: confirmedLiterature.literatureId,
      revision: confirmedLiterature.revision
    },
    scopeId: "user:alice",
    scopeType: "user",
    sessionId: "ltsy_session"
  });
  expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
});

function switchCloudAccount() {
  storeAccountSession({ email: "bob@example.test", expiresAt: "2099-01-01T00:00:00Z", name: "Bob", sessionId: "token-b", userId: "bob" });
}

test("does not use B's token for the download after A's authorization resolves late", async () => {
  let finish!: (response: Response) => void;
  const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
    .mockImplementation(async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
  const client = createCloudLibraryStorageClient({ endpoint: "https://cloud.example.test", fetchImpl: fetchImpl as typeof fetch });
  const download = client.downloadDocumentStream({ scopeId: "org-1", scopeType: "organization" }, "document-1");
  switchCloudAccount();
  finish(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
  await expect(download).rejects.toMatchObject({ code: "account_session_changed" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("a duplicate confirmation cannot retry A's upload using B's token", async () => {
  const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: "duplicate", duplicates: [] }), { status: 200 }));
  const client = createCloudLibraryStorageClient({ endpoint: "https://cloud.example.test", fetchImpl: fetchImpl as typeof fetch });
  await expect(client.uploadDocument({
    scope: { scopeId: "user:alice", scopeType: "user" }, expectedRevision: 1,
    file: new File(["%PDF-synthetic"], "synthetic.pdf"),
    onDuplicate: async () => { switchCloudAccount(); return true; }
  })).rejects.toMatchObject({ code: "account_session_changed" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});


test("an authorized stream stops delivering bytes after the account changes", async () => {
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([37, 80, 68, 70])); } });
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(source, { status: 200 }));
  const client = createCloudLibraryStorageClient({ endpoint: "https://cloud.example.test", fetchImpl: fetchImpl as typeof fetch });
  const stream = await client.downloadDocumentStream({ scopeId: "org-1", scopeType: "organization" }, "document-1", "export");
  switchCloudAccount();
  await expect(stream.getReader().read()).rejects.toMatchObject({ code: "account_session_changed" });
});

test.each(["endpoint", "issuer", "subject", "scope"])("cloud cache does not reuse the same document ID across %s bindings", async (changed) => {
  const first = { email: "alice@example.test", name: "Alice", expiresAt: "2099-01-01T00:00:00Z", endpoint: "https://cloud.example.test", issuer: "https://identity.example.test", userId: "alice", sessionId: "token-a" };
  storeAccountSession(first);
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("/authorize")
    ? new Response(JSON.stringify({ document: { contentHash: "same-bytes" }, expiresAt: "2099-01-01T00:00:00Z", serverNow: "2026-10-03T00:00:00Z" }), { status: 200 })
    : new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
  const scope = { scopeId: "same-scope", scopeType: "organization" as const };
  await createCloudLibraryStorageClient({ endpoint: first.endpoint, fetchImpl }).openDocument(scope, "same-document");
  const next = { ...first, ...(changed === "endpoint" ? { endpoint: "https://other.example.test" } : {}), ...(changed === "issuer" ? { issuer: "https://other-idp.example.test" } : {}), ...(changed === "subject" ? { userId: "bob" } : {}) };
  storeAccountSession(next);
  const nextScope = changed === "scope" ? { ...scope, scopeType: "user" as const } : scope;
  await createCloudLibraryStorageClient({ endpoint: next.endpoint, fetchImpl }).openDocument(nextScope, "same-document");
  expect(readCachedPdf).not.toHaveBeenCalled();
  expect(cacheExternalPdf).toHaveBeenCalledTimes(2);
  expect(Object.keys(localStorage).filter((key) => key.startsWith("liteasy.cloud-document-cache.v2"))).toHaveLength(2);
  expect(JSON.stringify(localStorage)).not.toContain("token-a");
});

test("a legacy session without a verified issuer never acquires an old persistent cache", async () => {
  localStorage.setItem("liteasy.cloud-document-cache.v1::user%3Aalice::organization::org-1::document-1", JSON.stringify({ cachePath: "old-private-cache.pdf", contentHash: "same-bytes" }));
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("/authorize")
    ? new Response(JSON.stringify({ document: { contentHash: "same-bytes" } }), { status: 200 })
    : new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
  await createCloudLibraryStorageClient({ endpoint: "https://cloud.example.test", fetchImpl }).openDocument({ scopeId: "org-1", scopeType: "organization" }, "document-1");
  expect(readCachedPdf).not.toHaveBeenCalled();
  expect(Object.keys(localStorage).filter((key) => key.startsWith("liteasy.cloud-document-cache.v2"))).toHaveLength(0);
  expect(localStorage.getItem("liteasy.cloud-document-cache.v1::user%3Aalice::organization::org-1::document-1")).toContain("old-private-cache.pdf");
});
