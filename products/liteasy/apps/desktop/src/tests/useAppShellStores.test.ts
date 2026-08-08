import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useAppShellStores } from "../app/layout/useAppShellStores";
import { starterPapers } from "./fixtures/starterPapers";

describe("useAppShellStores", () => {
  test("accepts test-injected papers once and keeps stable store refs", () => {
    const { result, rerender } = renderHook(() => useAppShellStores(undefined, starterPapers));

    expect(result.current.workspaceStoreRef.current.getState().papers.map((paper) => paper.id)).toEqual([
      "demo-1",
      "demo-2",
      "demo-3",
      "local-qvla",
      "local-compactflash-ftl"
    ]);

    const workspaceStore = result.current.workspaceStoreRef.current;
    workspaceStore.addPaper({ id: "paper-3", title: "Paper 3" });

    rerender();

    expect(result.current.workspaceStoreRef.current).toBe(workspaceStore);
    expect(result.current.workspaceStoreRef.current.getState().papers.map((paper) => paper.id)).toEqual([
      "demo-1",
      "demo-2",
      "demo-3",
      "local-qvla",
      "local-compactflash-ftl",
      "paper-3"
    ]);
  });

  test("creates seeded settings and stable import/artifact stores", () => {
    const { result, rerender } = renderHook(() =>
      useAppShellStores({
        "models.default_provider": "deepseek",
        "network.recommendation.enabled": false
      })
    );

    const importStore = result.current.importStoreRef.current;
    const artifactStore = result.current.artifactStore;

    expect(result.current.settingsStoreRef.current.getState()["models.default_provider"]).toBe("deepseek");
    expect(result.current.settingsStoreRef.current.getState()["network.recommendation.enabled"]).toBe(false);

    rerender();

    expect(result.current.importStoreRef.current).toBe(importStore);
    expect(result.current.artifactStore).toBe(artifactStore);
  });
});
