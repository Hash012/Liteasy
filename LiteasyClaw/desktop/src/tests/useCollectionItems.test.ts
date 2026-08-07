import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useCollectionItems } from "../app/features/collection/useCollectionItems";
import type { AccountSession } from "../app/features/account/account.types";

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("useCollectionItems", () => {
  const accountSession: AccountSession = {
    email: "researcher@liteasy.dev",
    expiresAt: "2026-05-15T09:30:00Z",
    name: "Liteasy Researcher",
    sessionId: "demo-session-1"
  };

  test("does not restore collection items from local browser storage while logged out", () => {
    window.localStorage.setItem(
      "liteasy.collection.online.v1",
      JSON.stringify([
        {
          id: "paper-1",
          reason: "RAG baseline",
          savedAt: "2026-05-14T00:00:00.000Z",
          source: "semantic-scholar",
          title: "Retrieval-Augmented Generation"
        }
      ])
    );

    const { result } = renderHook(() => useCollectionItems());

    expect(result.current.collectionItems).toEqual([]);
    expect(result.current.message).toBe("登录后可用的云端收藏会显示在这里。");
  });

  test("requires login instead of reporting a local collection success", async () => {
    const { result } = renderHook(() => useCollectionItems());

    await act(async () => {
      await expect(result.current.collectRecommendation({
        id: "paper-1",
        reason: "RAG baseline",
        source: "semantic-scholar",
        title: "Retrieval-Augmented Generation"
      })).rejects.toThrow("登录后才能收藏关联推荐");
    });

    expect(result.current.collectionItems).toEqual([]);
    expect(window.localStorage.getItem("liteasy.collection.online.v1")).toBeNull();
    expect(result.current.message).toBe("登录后才能收藏关联推荐。");
  });

  test("uses a cloud transport when account session is available", async () => {
    const savedPayloads: unknown[] = [];
    const transport = async (payload: unknown) => {
      savedPayloads.push(payload);
      return {
        json: async () => ({
          items: [
            {
              id: "rec-vdbms-1",
              reason: "同样关注向量数据库系统架构与相似度检索能力。",
              savedAt: "2026-05-14T10:30:00.000Z",
              source: "Semantic Scholar",
              title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
            }
          ]
        }),
        ok: true,
        status: 200
      };
    };

    const { result } = renderHook(() =>
      useCollectionItems({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        transport
      })
    );

    await act(async () => {
      await result.current.collectRecommendation({
        id: "rec-vdbms-1",
        reason: "同样关注向量数据库系统架构与相似度检索能力。",
        source: "Semantic Scholar",
        title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
      });
    });

    expect(savedPayloads).toHaveLength(2);
    expect(savedPayloads[0]).toMatchObject({
      method: "POST",
      url: "https://liteasy.example.com/control-plane/v1/collection/list"
    });
    expect(savedPayloads[1]).toMatchObject({
      method: "POST",
      url: "https://liteasy.example.com/control-plane/v1/collection/items"
    });
    expect(result.current.collectionItems[0].id).toBe("rec-vdbms-1");
    expect(result.current.status).toBe("ready");
    expect(result.current.message).toBe("已同步云端收藏。");
  });

  test("shows loading state while cloud collection is syncing on login", async () => {
    let resolveTransport: ((value: { json: () => Promise<{ items: never[] }>; ok: true; status: 200 }) => void) | null =
      null;

    const transport = vi.fn(
      () =>
        new Promise<{ json: () => Promise<{ items: never[] }>; ok: true; status: 200 }>((resolve) => {
          resolveTransport = resolve;
        })
    );

    const { result } = renderHook(() =>
      useCollectionItems({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        transport
      })
    );

    expect(result.current.status).toBe("loading");
    expect(result.current.message).toBe("正在同步云端收藏...");

    await act(async () => {
      resolveTransport?.({
        json: async () => ({ items: [] }),
        ok: true,
        status: 200
      });
      await Promise.resolve();
    });

    expect(result.current.status).toBe("ready");
  });

  test("exposes retry state when cloud collection loading fails", async () => {
    const transport = vi.fn(async () => ({
      json: async () => ({
        invalid: true
      }),
      ok: true,
      status: 200
    }));

    const { result } = renderHook(() =>
      useCollectionItems({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        transport
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.message).toBe("云端收藏暂时不可用。");

    transport.mockImplementationOnce(async () => ({
      json: async () => ({ items: [] }),
      ok: true,
      status: 200
    }));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.message).toBe("已同步云端收藏。");
  });
});
