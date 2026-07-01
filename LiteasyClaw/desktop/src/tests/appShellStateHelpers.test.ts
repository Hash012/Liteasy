import { describe, expect, test } from "vitest";
import { starterPapers } from "../app/layout/starterPapers";
import { cloneWorkspaceState } from "../app/features/workspace/workspaceStateHelpers";
import { cloneSettingsState, createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("AppShell state helpers", () => {
  test("provides starter papers without sharing mutable arrays", () => {
    expect(starterPapers.map((paper) => paper.id)).toEqual(["demo-1", "demo-2", "demo-3"]);
    expect(starterPapers.map((paper) => paper.title)).toEqual([
      "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
      "Survey of Vector Database Management Systems",
      "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
    ]);
    expect(starterPapers.map((paper) => paper.sourcePath)).toEqual([
      "/papers/colbert-late-interaction.pdf",
      "/papers/survey-vector-database-management-systems.pdf",
      "/papers/acorn-vector-search.pdf"
    ]);
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
    settings["models.default_provider"] = "deepseek";
    expect(createSeededSettingsStore().getState()["models.default_provider"]).toBe("openai");
  });

  test("creates a seeded settings store from partial settings", () => {
    const store = createSeededSettingsStore({
      "models.default_provider": "deepseek",
      "network.recommendation.enabled": false
    });

    expect(store.getState()["models.default_provider"]).toBe("deepseek");
    expect(store.getState()["network.recommendation.enabled"]).toBe(false);
  });
});
