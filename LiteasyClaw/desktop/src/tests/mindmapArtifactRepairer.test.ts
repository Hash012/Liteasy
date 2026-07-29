import { expect, test } from "vitest";
import { repairMindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifactRepairer";
import { verifyMindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifactVerifier";
import type { MindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifact.types";

function artifactWithMissingChildSource(): MindmapArtifact {
  return {
    artifactId: "artifact-mindmap-repair",
    createdAt: "2026-07-26T00:00:00.000Z",
    root: {
      children: [
        {
          children: [
            {
              children: [],
              confidence: "high",
              id: "node-claim-1",
              label: "MaxSim 聚合 token 相似度",
              nodeType: "paper_claim",
              sourceRefs: []
            }
          ],
          confidence: "high",
          id: "node-paper-1",
          label: "ColBERT",
          nodeType: "topic",
          sourceRefs: ["paper:evidence-1"]
        }
      ],
      confidence: "high",
      id: "root",
      label: "ColBERT 思维导图",
      nodeType: "topic",
      sourceRefs: []
    },
    runId: "run-1",
    sources: {
      externalReferences: [],
      inferences: [],
      selectedPapers: [
        {
          evidenceId: "evidence-1",
          paperId: "paper-1",
          paperTitle: "ColBERT",
          refId: "paper:evidence-1",
          snippet: "ColBERT uses MaxSim to aggregate token-level similarities."
        }
      ]
    },
    title: "ColBERT 思维导图",
    verification: {
      checkedAt: "2026-07-26T00:00:00.000Z",
      errors: [],
      repairable: false,
      status: "review",
      warnings: []
    },
    version: "liteasy.mindmap-artifact/v1"
  };
}

test("repairs a critical child node by inheriting a verified parent source ref", () => {
  const draft = artifactWithMissingChildSource();
  const failed = verifyMindmapArtifact(draft, {
    selectedPaperIds: ["paper-1"],
    now: () => new Date("2026-07-26T00:00:01.000Z")
  });

  const repaired = repairMindmapArtifact(draft, failed);
  const passed = verifyMindmapArtifact(repaired.artifact, {
    selectedPaperIds: ["paper-1"],
    now: () => new Date("2026-07-26T00:00:02.000Z")
  });

  expect(repaired.appliedRepairs).toEqual([
    {
      code: "inherited_parent_source_refs",
      nodeId: "node-claim-1",
      sourceRefs: ["paper:evidence-1"]
    }
  ]);
  expect(repaired.artifact.root.children[0].children[0].sourceRefs).toEqual(["paper:evidence-1"]);
  expect(passed.status).toBe("pass");
});

test("does not repair missing selected paper evidence coverage", () => {
  const draft = artifactWithMissingChildSource();
  const failed = verifyMindmapArtifact(draft, {
    selectedPaperIds: ["paper-1", "paper-2"],
    now: () => new Date("2026-07-26T00:00:01.000Z")
  });

  const repaired = repairMindmapArtifact(draft, failed);

  expect(repaired.appliedRepairs).toHaveLength(1);
  expect(repaired.unresolvedIssueCodes).toContain("missing_selected_paper_coverage");
});
