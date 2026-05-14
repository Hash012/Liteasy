import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useCollectionItems } from "../app/features/collection/useCollectionItems";

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("useCollectionItems", () => {
  test("restores stored collection items", () => {
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

    expect(result.current.collectionItems).toEqual([
      {
        id: "paper-1",
        reason: "RAG baseline",
        savedAt: "2026-05-14T00:00:00.000Z",
        source: "semantic-scholar",
        title: "Retrieval-Augmented Generation"
      }
    ]);
  });

  test("collects recommendations at the top and replaces duplicates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T10:30:00.000Z"));
    const { result } = renderHook(() => useCollectionItems());

    act(() => {
      result.current.collectRecommendation({
        id: "paper-1",
        reason: "RAG baseline",
        source: "semantic-scholar",
        title: "Retrieval-Augmented Generation"
      });
    });
    act(() => {
      result.current.collectRecommendation({
        id: "paper-2",
        reason: "Long context evaluation",
        source: "arxiv",
        title: "Long-Context Evaluation"
      });
    });
    act(() => {
      result.current.collectRecommendation({
        id: "paper-1",
        reason: "Updated RAG baseline",
        source: "semantic-scholar",
        title: "Retrieval-Augmented Generation"
      });
    });

    expect(result.current.collectionItems).toEqual([
      {
        id: "paper-1",
        reason: "Updated RAG baseline",
        savedAt: "2026-05-14T10:30:00.000Z",
        source: "semantic-scholar",
        title: "Retrieval-Augmented Generation"
      },
      {
        id: "paper-2",
        reason: "Long context evaluation",
        savedAt: "2026-05-14T10:30:00.000Z",
        source: "arxiv",
        title: "Long-Context Evaluation"
      }
    ]);
    expect(JSON.parse(window.localStorage.getItem("liteasy.collection.online.v1") ?? "[]"))
      .toEqual(result.current.collectionItems);
  });
});
