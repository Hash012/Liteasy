import { vi } from "vitest";
import { storeAccountSession } from "../app/features/account/accountSessionStorage";
import { createCloudLibraryStorageClient } from "../app/features/library/cloudLibraryStorageClient";

beforeEach(() => {
  window.localStorage.clear();
  storeAccountSession({
    email: "alice@example.com",
    expiresAt: "2026-08-03T00:00:00.000Z",
    membershipTier: "pro",
    name: "Alice",
    sessionId: "ltsy_session",
    userId: "alice"
  });
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

  expect(result).toBe(stream);
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
