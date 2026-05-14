import { createDocumentMetadataClient } from "../app/features/metadata/documentMetadataClient";

test("posts visible workspace document metadata to the cloud endpoint", async () => {
  const requests: unknown[] = [];
  const client = createDocumentMetadataClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push(request);

      return {
        json: async () => ({
          result: {
            acceptedCount: 2,
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
        id: "demo-1",
        sourcePath: "fixtures/attention-is-all-you-need.pdf",
        title: "Attention Is All You Need"
      },
      {
        id: "demo-2",
        sourcePath: "fixtures/bert-pretraining.pdf",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ],
    sessionId: "demo-session-1",
    workspaceRevision: 0
  });

  expect(result).toEqual({
    acceptedCount: 2,
    rejectedCount: 0,
    syncId: "metadata-sync-1",
    syncedAt: "2026-05-14T10:20:00Z"
  });
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        documents: [
          {
            id: "demo-1",
            sourcePath: "fixtures/attention-is-all-you-need.pdf",
            title: "Attention Is All You Need"
          },
          {
            id: "demo-2",
            sourcePath: "fixtures/bert-pretraining.pdf",
            title: "BERT: Pre-training of Deep Bidirectional Transformers"
          }
        ],
        sessionId: "demo-session-1",
        workspaceRevision: 0
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: "https://liteasy.example.com/control-plane/v1/documents/metadata-sync"
    }
  ]);
});
