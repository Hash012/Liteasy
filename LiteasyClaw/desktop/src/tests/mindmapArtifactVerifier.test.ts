import { describe, expect, test } from "vitest";
import { verifyMindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifactVerifier";
import type { MindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifact.types";

function validArtifact(): MindmapArtifact {
  return {
    artifactId: "artifact-mindmap-1",
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
              sourceRefs: ["paper:evidence-1"]
            }
          ],
          confidence: "high",
          id: "node-paper-1",
          label: "ColBERT",
          nodeType: "paper_claim",
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
      status: "pass",
      warnings: []
    },
    version: "liteasy.mindmap-artifact/v1"
  };
}

describe("mindmapArtifactVerifier", () => {
  test("passes a sourced mindmap that covers every selected paper", () => {
    const report = verifyMindmapArtifact(validArtifact(), {
      selectedPaperIds: ["paper-1"]
    });

    expect(report.status).toBe("pass");
    expect(report.errors).toEqual([]);
  });

  test("fails when a critical paper claim has no source refs", () => {
    const artifact = validArtifact();
    artifact.root.children[0].children[0].sourceRefs = [];

    const report = verifyMindmapArtifact(artifact, { selectedPaperIds: ["paper-1"] });

    expect(report.status).toBe("fail");
    expect(report.repairable).toBe(true);
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "critical_fact_without_source" })
    ]);
  });

  test("fails when a source ref does not exist in the catalog", () => {
    const artifact = validArtifact();
    artifact.root.children[0].children[0].sourceRefs = ["paper:missing"];

    const report = verifyMindmapArtifact(artifact, { selectedPaperIds: ["paper-1"] });

    expect(report.status).toBe("fail");
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "source_ref_not_found" })
    ]);
  });

  test("fails when a selected paper is not covered by the mindmap", () => {
    const report = verifyMindmapArtifact(validArtifact(), {
      selectedPaperIds: ["paper-1", "paper-2"]
    });

    expect(report.status).toBe("fail");
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "missing_selected_paper_coverage" })
    ]);
  });

  test("fails when a low-authority external reference supports a main claim", () => {
    const artifact = validArtifact();
    artifact.sources.externalReferences = [
      {
        authorityLevel: "low",
        reason: "background",
        refId: "external:blog-summary",
        sourceTitle: "Unreviewed blog summary",
        summary: "A weak secondary source."
      }
    ];
    artifact.root.children[0].children[0].sourceRefs = [
      "paper:evidence-1",
      "external:blog-summary"
    ];

    const report = verifyMindmapArtifact(artifact, { selectedPaperIds: ["paper-1"] });

    expect(report.status).toBe("fail");
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "external_low_authority_main_claim" })
    ]);
  });

  test("fails when the mindmap structure has an unlabeled root", () => {
    const artifact = validArtifact();
    artifact.root.label = "";

    const report = verifyMindmapArtifact(artifact, { selectedPaperIds: ["paper-1"] });

    expect(report.status).toBe("fail");
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "invalid_structure" })
    ]);
  });
});
