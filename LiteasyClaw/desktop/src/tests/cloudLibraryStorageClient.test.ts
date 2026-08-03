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
  const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
  const client = createCloudLibraryStorageClient({
    endpoint: "http://127.0.0.1:8787",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  await expect(client.openDocument(
    { scopeId: "org-1", scopeType: "organization" },
    "document-1"
  )).rejects.toThrow("必须联网重新校验");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toBe(
    "http://127.0.0.1:8787/v1/library/documents/authorize"
  );
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
