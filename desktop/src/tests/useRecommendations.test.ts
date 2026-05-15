import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useRecommendations } from "../app/features/recommendations/useRecommendations";
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

describe("useRecommendations", () => {
  test("falls back to local-reader semantics when cloud account is unavailable", async () => {
    const { result } = renderHook(() =>
      useRecommendations({
        accountSession: null,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("unauthenticated");
    });

    expect(result.current.recommendationMessage).toBe(
      "当前已退化为本地阅读器，云端推荐不可用。联网并登录后，将自动恢复云端能力。"
    );
  });

  test("loads cloud recommendations when a cloud account is available", async () => {
    const { result } = renderHook(() =>
      useRecommendations({
        accountSession,
        controlPlaneEndpoint: "mock://control-plane",
        recommendationsEnabled: true,
        recommendationSortMode: "relevance",
        selectedPapers,
        workspaceRevision: 0
      })
    );

    await waitFor(() => {
      expect(result.current.recommendationStatus).toBe("ready");
    });

    expect(result.current.recommendationItems.length).toBeGreaterThan(0);
  });
});
