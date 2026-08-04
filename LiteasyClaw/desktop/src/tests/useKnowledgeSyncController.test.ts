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
  test("exposes cloud knowledge sync model for shell panes", async () => {
    const collectionTransport = vi.fn(async () => ({
      json: async () => ({ items: [] }),
      ok: true,
      status: 200
    }));
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
        collectionTransport,
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
        selectedPapers,
        workspaceRevision: 3,
        workspaceSourceKey: "local:/tmp/LiteasyLibrary"
      })
    );

    await waitFor(() => {
      expect(result.current.model.recommendationStatus).toBe("ready");
      expect(result.current.model.collectionStatus).toBe("ready");
      expect(result.current.model.documentMetadataSyncStatus).toBe("success");
    });

    expect(result.current.model.documentMetadataSyncResult).toEqual(
      expect.objectContaining({ acceptedCount: 1 })
    );
  });

  test("records a saved preference after a recommendation is collected", async () => {
    const feedbackRequests: string[] = [];
    const collectionTransport = vi.fn(async (request: { body: string; url: string }) => ({
      json: async () => request.url.endsWith("/items")
        ? { items: [{ ...JSON.parse(request.body).item }] }
        : { items: [] },
      ok: true,
      status: 200
    }));
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
      collectionTransport,
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
      selectedPapers,
      workspaceRevision: 0,
      workspaceSourceKey: "local:/tmp/LiteasyLibrary"
    }));
    await waitFor(() => expect(result.current.model.collectionStatus).toBe("ready"));

    await act(async () => {
      await result.current.actions.collectRecommendation({
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
