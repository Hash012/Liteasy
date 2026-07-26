import { describe, expect, test, vi } from "vitest";
import { runMindmapArtifactWorkflow } from "../app/features/artifact-workflow/mindmapWorkflowHarness";
import type { ExternalKnowledgeProvider } from "../app/features/artifact-workflow/externalKnowledgeProvider";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import { prepareMultiPaperAnalysis } from "../app/features/paper-analysis/multiPaperAnalysisWorkflow";
import type { Paper } from "../app/features/workspace/workspace.types";

const colbertPaper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

function createIdFactory() {
  let sequence = 0;
  return (kind: "analysis" | "claim" | "evidence") => {
    sequence += 1;
    return `${kind}-${sequence}`;
  };
}

describe("mindmapWorkflowHarness", () => {
  test("builds a verified mindmap with paper evidence and external knowledge sources", async () => {
    const prepared = prepareMultiPaperAnalysis({
      createId: createIdFactory(),
      importedChunksByPaperId: {
        [colbertPaper.id]: buildImportedChunksForPaper(colbertPaper)
      },
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      query: "解释 ColBERT 的 Late Interaction",
      selectedPapers: [colbertPaper]
    });
    const externalKnowledgeProvider: ExternalKnowledgeProvider = {
      lookup: vi.fn(async () => [
        {
          authorityLevel: "high",
          reason: "concept_definition",
          refId: "external:late-interaction",
          sourceTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
          summary: "Late interaction preserves token-level matching signals before aggregation."
        }
      ])
    };

    const result = await runMindmapArtifactWorkflow({
      artifactId: "artifact-mindmap-1",
      externalKnowledgeProvider,
      generatedAnswer: "ColBERT 使用 late interaction 和 MaxSim。",
      now: () => new Date("2026-07-26T00:01:00.000Z"),
      prepared,
      question: "解释 ColBERT 的 Late Interaction",
      runId: "run-1",
      selectedPapers: [colbertPaper]
    });

    expect(externalKnowledgeProvider.lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        terms: expect.arrayContaining(["late interaction", "MaxSim"])
      })
    );
    expect(result.status).toBe("verified");
    expect(result).toMatchObject({
      artifact: {
        sources: {
          externalReferences: [
            expect.objectContaining({ refId: "external:late-interaction" })
          ],
          selectedPapers: expect.arrayContaining([
            expect.objectContaining({
              evidenceId: prepared.evidence[0].id,
              refId: `paper:${prepared.evidence[0].id}`
            })
          ])
        },
        verification: { status: "pass" }
      }
    });
    expect(result.workflowTrace).toMatchObject({
      artifactId: "artifact-mindmap-1",
      internalOnly: true,
      runId: "run-1",
      steps: [
        expect.objectContaining({
          kind: "scope",
          status: "completed",
          summary: "固定思维导图任务范围"
        }),
        expect.objectContaining({
          kind: "external_lookup",
          status: "completed",
          summary: "补充外部知识来源"
        }),
        expect.objectContaining({
          kind: "draft",
          status: "completed",
          summary: "构造思维导图草稿"
        }),
        expect.objectContaining({
          kind: "verification",
          status: "completed",
          summary: "确定性校验通过"
        })
      ]
    });
  });

  test("returns blocked when the generated draft cannot cover every selected paper", async () => {
    const missingPaper: Paper = {
      id: "paper-without-evidence",
      sourcePath: "fixtures/missing.pdf",
      title: "Missing Evidence Paper"
    };
    const prepared = prepareMultiPaperAnalysis({
      createId: createIdFactory(),
      importedChunksByPaperId: {
        [colbertPaper.id]: buildImportedChunksForPaper(colbertPaper)
      },
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      query: "比较方法",
      selectedPapers: [colbertPaper, missingPaper]
    });

    const result = await runMindmapArtifactWorkflow({
      artifactId: "artifact-mindmap-2",
      externalKnowledgeProvider: { lookup: vi.fn(async () => []) },
      generatedAnswer: "只有 ColBERT 有证据。",
      now: () => new Date("2026-07-26T00:01:00.000Z"),
      prepared,
      question: "比较方法",
      runId: "run-2",
      selectedPapers: [colbertPaper, missingPaper]
    });

    expect(result.status).toBe("blocked");
    expect(result).toMatchObject({
      draft: {
        verification: { status: "fail" }
      },
      verification: {
        errors: [
          expect.objectContaining({ code: "missing_selected_paper_coverage" })
        ],
        status: "fail"
      }
    });
    expect(result.workflowTrace).toMatchObject({
      internalOnly: true,
      steps: expect.arrayContaining([
        expect.objectContaining({
          kind: "verification",
          status: "blocked",
          summary: "确定性校验未通过"
        }),
        expect.objectContaining({
          kind: "repair",
          status: "blocked",
          summary: "没有安全自动修复策略，保持草稿阻断"
        })
      ])
    });
  });
});
