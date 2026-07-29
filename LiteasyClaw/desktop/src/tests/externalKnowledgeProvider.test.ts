import { describe, expect, test } from "vitest";
import { createDeterministicExternalKnowledgeProvider } from "../app/features/artifact-workflow/externalKnowledgeProvider";

describe("externalKnowledgeProvider", () => {
  test("returns authoritative concept references for recognized evidence terms", async () => {
    const provider = createDeterministicExternalKnowledgeProvider();

    const references = await provider.lookup({
      question: "解释 ColBERT 的 Late Interaction",
      terms: ["late interaction", "MaxSim"],
      timeoutMs: 1000
    });

    expect(references).toEqual([
      expect.objectContaining({
        authorityLevel: "high",
        reason: "concept_definition",
        sourceTitle: expect.stringContaining("ColBERT")
      })
    ]);
  });

  test("returns no external references for unknown terms instead of inventing sources", async () => {
    const provider = createDeterministicExternalKnowledgeProvider();

    await expect(
      provider.lookup({
        question: "unknown",
        terms: ["unrecognized-private-term"],
        timeoutMs: 1000
      })
    ).resolves.toEqual([]);
  });
});
