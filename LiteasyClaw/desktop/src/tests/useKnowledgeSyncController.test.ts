import { renderHook, waitFor } from "@testing-library/react";
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
          fetch: vi.fn()
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
});
