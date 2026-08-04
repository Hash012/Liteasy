import { describe, expect, test } from "vitest";
import {
  compactThinReadingContext,
  estimateThinReadingTokens,
  planThinReadingWorkload
} from "../app/features/thin-reading/thinReadingWorkload";
import type { ThinReadingGenerationContext } from "../app/features/thin-reading/thinReading.types";

describe("thin-reading context and workload planning", () => {
  test("keeps small loads on the main Agent and escalates bounded larger loads", () => {
    expect(planThinReadingWorkload({
      depth: 0,
      evidenceCharacters: 8_000,
      evidenceCount: 6
    })).toMatchObject({ maxConcurrency: 0, strategy: "direct" });

    expect(planThinReadingWorkload({
      depth: 1,
      evidenceCharacters: 20_000,
      evidenceCount: 10,
      requestedOutput: "html_demo"
    })).toMatchObject({
      maxConcurrency: 1,
      plannedSubagents: ["evidence_reviewer"],
      strategy: "guided"
    });

    expect(planThinReadingWorkload({
      depth: 2,
      evidenceCharacters: 80_000,
      evidenceCount: 36,
      figureCount: 8
    })).toMatchObject({
      maxConcurrency: 2,
      plannedSubagents: expect.arrayContaining(["relationship_mapper", "visual_editor"]),
      strategy: "parallel"
    });
  });

  test("retains the selected passage and recent relevant ancestors inside a bounded context", () => {
    const context: ThinReadingGenerationContext = {
      ancestorSummaries: Array.from({ length: 12 }, (_, index) => ({
        nodeId: `node-${index}`,
        summary: index === 2 ? "MaxSim 的机制与匹配关系。" : `背景段落 ${index}。`.repeat(120),
        title: index === 2 ? "MaxSim" : `背景 ${index}`
      })),
      artifactId: "artifact-context-budget",
      depth: 3,
      paperIds: ["paper-1"],
      parentClaims: Array.from({ length: 10 }, (_, index) => ({
        evidenceIds: [`evidence-${index}`],
        id: `claim-${index}`,
        status: "grounded" as const,
        text: `判断 ${index}`
      })),
      parentEvidenceSpans: Array.from({ length: 10 }, (_, index) => ({
        confidence: 0.9,
        id: `evidence-${index}`,
        paperId: "paper-1",
        quote: "论文原文证据。".repeat(200)
      })),
      source: {
        excerpt: "MaxSim 如何完成 token-level matching？",
        kind: "selected_text"
      },
      targetLanguage: "zh-CN"
    };

    const compacted = compactThinReadingContext(context, 5_200);

    expect(compacted.context.source).toEqual(context.source);
    expect(compacted.context.ancestorSummaries).toHaveLength(4);
    expect(compacted.context.ancestorSummaries?.some((ancestor) => ancestor.nodeId === "node-2")).toBe(true);
    expect(compacted.context.ancestorSummaries?.some((ancestor) => ancestor.nodeId === "node-11")).toBe(true);
    expect(compacted.context.parentClaims).toHaveLength(4);
    expect(compacted.context.parentEvidenceSpans).toHaveLength(6);
    expect(compacted.audit).toMatchObject({
      droppedAncestors: 8,
      droppedClaims: 6,
      droppedEvidenceSpans: 4,
      tokenBudget: 5_200
    });
    expect(compacted.audit.estimatedTokens).toBeLessThanOrEqual(compacted.audit.tokenBudget);
    expect(compacted.audit.estimatedTokens).toBe(estimateThinReadingTokens(JSON.stringify(compacted.context)));
  });
});
