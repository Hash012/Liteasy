import { createDocumentMetadataClient } from "../app/features/metadata/documentMetadataClient";

test("posts only account-scoped identifiers and necessary bibliographic metadata", async () => {
  const requests: unknown[] = [];
  const client = createDocumentMetadataClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push(request);

      return {
        json: async () => ({
          result: {
            acceptedCount: 3,
            rejectedCount: 0,
            syncId: "metadata-sync-1",
            syncedAt: "2026-05-14T10:20:00Z"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client({
    documents: [
      {
        authors: ["Omar Khattab", "Matei Zaharia"],
        contentHash: "a".repeat(64),
        doi: "10.1145/example",
        publicationYear: 2020,
        syncDocumentId: "local-account-paper-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      },
      {
        syncDocumentId: "local-account-paper-2",
        title: "Survey of Vector Database Management Systems"
      },
      {
        syncDocumentId: "local-account-paper-3",
        title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
      }
    ],
    sessionId: "demo-session-1",
    workspaceRevision: 0
  });

  expect(result).toEqual({
    acceptedCount: 3,
    rejectedCount: 0,
    syncId: "metadata-sync-1",
    syncedAt: "2026-05-14T10:20:00Z"
  });
  expect(requests).toHaveLength(1);
  const request = requests[0] as {
    body: string;
    headers: Record<string, string>;
    method: string;
    url: string;
  };
  expect(JSON.parse(request.body)).toMatchObject({
        documents: [
          {
            authors: ["Omar Khattab", "Matei Zaharia"],
            contentHash: "a".repeat(64),
            doi: "10.1145/example",
            publicationYear: 2020,
            syncDocumentId: "local-account-paper-1",
            title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
          },
          {
            syncDocumentId: "local-account-paper-2",
            title: "Survey of Vector Database Management Systems"
          },
          {
            syncDocumentId: "local-account-paper-3",
            title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
          }
        ],
        sessionId: "demo-session-1",
        workspaceRevision: 0
  });
  expect(JSON.parse(request.body).idempotencyKey).toMatch(/^manifest:/);
  expect(request.headers).toEqual({
    Authorization: "Bearer demo-session-1",
    "Content-Type": "application/json"
  });
  expect(request.method).toBe("POST");
  expect(request.url).toBe("https://liteasy.example.com/control-plane/v1/documents/metadata-sync");
});
