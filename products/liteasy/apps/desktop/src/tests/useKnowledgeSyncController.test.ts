import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useKnowledgeSyncController } from "../app/controllers/useKnowledgeSyncController";
import type { AccountSession } from "../app/features/account/account.types";
import type { Paper } from "../app/features/workspace/workspace.types";

const accountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

const selectedPapers: Paper[] = [
  {
    id: "paper-1",
    sourcePath: "fixtures/paper-1.pdf",
    title: "Attention Is All You Need"
  }
];

describe("useKnowledgeSyncController", () => {
  test("does not upload a local manifest while personalization is disabled", async () => {
    const documentMetadataTransport = vi.fn();
    const { result } = renderHook(() => useKnowledgeSyncController({
      accountSession,
      controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
      documentMetadataTransport,
      documents: selectedPapers,
      personalizationEnabled: false,
      recommendationCacheDeps: {
        clear: vi.fn(),
        get: vi.fn(async () => ({ cacheHit: true, recommendations: [] })),
        put: vi.fn()
      },
      recommendationGeneratorDeps: { fetch: vi.fn(async () => []) },
      recommendationsEnabled: true,
      recommendationSortMode: "relevance",
      selectedPapers,
      workspaceRevision: 0,
      workspaceSourceKey: "local_library:/tmp/LiteasyLibrary"
    }));

    await waitFor(() => expect(result.current.model.documentMetadataSyncStatus).toBe("idle"));
    expect(result.current.model.documentMetadataSyncMessage).toContain("个性化已关闭");
    expect(documentMetadataTransport).not.toHaveBeenCalled();
  });

  test("exposes cloud knowledge sync model for shell panes", async () => {
    const documentMetadataTransport = vi.fn(async () => ({
      json: async () => ({
        result: {
          acceptedCount: 1,
          rejectedCount: 0,
          syncId: "sync-1",
          syncedAt: "2026-05-15T09:30:00.000Z"
        }
      }),
      ok: true,
      status: 200
    }));

    const { result } = renderHook(() =>
      useKnowledgeSyncController({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        documentMetadataTransport,
        documents: selectedPapers,
        recommendationCacheDeps: {
          clear: vi.fn(),
          get: vi.fn(async () => ({
            cacheHit: true,
            recommendations: []
          })),
          put: vi.fn()
        },
        recommendationGeneratorDeps: {
          fetch: vi.fn(async () => [])
        },
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        personalizationEnabled: true,
        selectedPapers,
        workspaceRevision: 3,
        workspaceSourceKey: "local_library:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.model.recommendationStatus).toBe("ready");
      expect(result.current.model.documentMetadataSyncStatus).toBe("success");
    });

    expect(result.current.model.documentMetadataSyncResult).toEqual(
      expect.objectContaining({ acceptedCount: 1 })
    );
    const manifestBody = JSON.parse(documentMetadataTransport.mock.calls[0][0].body);
    expect(manifestBody.documents[0]).toEqual(expect.objectContaining({
      syncDocumentId: expect.stringMatching(/^local-[a-f0-9]{64}$/),
      title: "Attention Is All You Need"
    }));
    expect(JSON.stringify(manifestBody.documents)).not.toContain("sourcePath");
    expect(JSON.stringify(manifestBody.documents)).not.toContain("fixtures/");
  });

  test("records a saved preference after a recommendation is collected", async () => {
    const feedbackRequests: string[] = [];
    const documentMetadataTransport = vi.fn(async () => ({
      json: async () => ({ result: { acceptedCount: 1, rejectedCount: 0, syncId: "sync", syncedAt: "2026-07-29T00:00:00Z" } }),
      ok: true,
      status: 200
    }));
    const recommendationFeedbackTransport = vi.fn(async (request: { body: string }) => {
      feedbackRequests.push(request.body);
      return { json: async () => ({ feedback: { action: "saved" } }), ok: true, status: 200 };
    });
    const { result } = renderHook(() => useKnowledgeSyncController({
      accountSession,
      controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
      documentMetadataTransport,
      documents: selectedPapers,
      recommendationCacheDeps: {
        clear: vi.fn(),
        get: vi.fn(async () => ({ cacheHit: true, recommendations: [] })),
        put: vi.fn()
      },
      recommendationFeedbackTransport,
      recommendationGeneratorDeps: { fetch: vi.fn(async () => []) },
      recommendationsEnabled: true,
      recommendationSortMode: "relevance",
      personalizationEnabled: true,
      selectedPapers,
      workspaceRevision: 0,
      workspaceSourceKey: "local_library:/tmp/LiteasyLibrary"
    }));
    await act(async () => {
      await result.current.actions.recordRecommendationSaved({
        canonicalId: "openalex:W200",
        discoveredAt: "2026-07-29T00:00:00Z",
        id: "reading-candidate:openalex:W200",
        relatedDocumentTitle: "Target Paper",
        relevanceBand: "high",
        relevanceScore: 0.9,
        reason: "reading lead",
        source: "OpenAlex",
        sourceKind: "live",
        sourceUrl: "https://openalex.org/W200",
        title: "Candidate Paper"
      });
    });

    expect(JSON.parse(feedbackRequests[0])).toMatchObject({
      action: "saved",
      candidate: { canonicalId: "openalex:W200", title: "Candidate Paper" }
    });
  });
});
