import { describe, expect, test } from "vitest";
import { starterPapers } from "../app/layout/starterPapers";
import { cloneWorkspaceState } from "../app/features/workspace/workspaceStateHelpers";
import { cloneSettingsState, createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("AppShell state helpers", () => {
  test("provides starter papers without sharing mutable arrays", () => {
    expect(starterPapers.map((paper) => paper.id)).toEqual(["demo-1", "demo-2"]);
    expect(starterPapers[0].title).toBe("Attention Is All You Need");
  });

  test("clones workspace and settings state snapshots", () => {
    const workspace = cloneWorkspaceState({
      papers: [{ id: "p1", title: "Paper 1" }],
      selectedPaperIds: ["p1"],
      selectionLocked: true,
      workspaceSource: {
        rootPath: "本地文献库",
        type: "local_library"
      },
      workspaceRevision: 3
    });
    workspace.papers.push({ id: "p2", title: "Paper 2" });
    workspace.selectedPaperIds.push("p2");
    expect(workspace.papers).toHaveLength(2);

    const settings = cloneSettingsState(createSeededSettingsStore().getState());
    settings["models.access_mode"] = "local_direct";
    expect(createSeededSettingsStore().getState()["models.access_mode"]).toBe("cloud_proxy");
  });

  test("creates a seeded settings store from partial settings", () => {
    const store = createSeededSettingsStore({
      "models.access_mode": "local_direct",
      "models.local_direct_enabled": true,
      "network.recommendation.enabled": false
    });

    expect(store.getState()["models.access_mode"]).toBe("local_direct");
    expect(store.getState()["models.local_direct_enabled"]).toBe(true);
    expect(store.getState()["network.recommendation.enabled"]).toBe(false);
  });
});
