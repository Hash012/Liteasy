import { describe, expect, test } from "vitest";
import {
  buildThinReadingPromptGuidance,
  classifyThinReadingPaperWithDiagnostics,
  getThinReadingFewShotExamples,
  thinReadingPaperTypes
} from "../app/features/thin-reading/thinReadingPromptRegistry";
import type { ThinReadingGenerationContext } from "../app/features/thin-reading/thinReading.types";

const rootContext: ThinReadingGenerationContext = {
  artifactId: "artifact-prompt-registry",
  depth: 0,
  paperIds: ["paper-hybrid"],
  primaryPaperId: "paper-hybrid",
  primaryPaperTitle: "A Benchmark Dataset for Retrieval",
  source: { kind: "root_overview" },
  targetLanguage: "zh-CN"
};

describe("thinReadingPromptRegistry", () => {
  test("provides exactly three original retention examples for every paper type and language", () => {
    for (const paperType of thinReadingPaperTypes) {
      const zhExamples = getThinReadingFewShotExamples(paperType, "zh-CN");
      const enExamples = getThinReadingFewShotExamples(paperType, "en-US");

      expect(zhExamples).toHaveLength(3);
      expect(enExamples).toHaveLength(3);
      expect(new Set(zhExamples).size).toBe(3);
      expect(new Set(enExamples).size).toBe(3);
      expect(zhExamples.every((example) => example.includes("留存"))).toBe(true);
      expect(enExamples.every((example) => example.includes("Retain"))).toBe(true);
    }
  });

  test("surfaces a benchmark-versus-dataset conflict with deterministic diagnostics", () => {
    const classification = classifyThinReadingPaperWithDiagnostics({
      evidencePrompt: "The evaluation suite includes a leaderboard, corpus collection protocol, and expert annotations.",
      title: "A Benchmark Dataset for Retrieval"
    });

    expect(classification.paperType).toBe("benchmark");
    expect(classification.conflict).toBe(true);
    expect(classification.confidence).toBe("low");
    expect(classification.winner).toMatchObject({
      evidenceScore: 5,
      paperType: "benchmark",
      titleScore: 5,
      totalScore: 15
    });
    expect(classification.runnerUp).toMatchObject({
      evidenceScore: 5,
      paperType: "dataset",
      titleScore: 5,
      totalScore: 15
    });
  });

  test("keeps a systems contribution primary even when its evidence contains experiments", () => {
    const classification = classifyThinReadingPaperWithDiagnostics({
      evidencePrompt: "Experiments and ablations report latency, throughput, baseline results, and scaling behavior.",
      title: "A Distributed Runtime Architecture for Production Search Systems"
    });

    expect(classification.paperType).toBe("systems");
    expect(classification.conflict).toBe(false);
    expect(classification.winner?.totalScore).toBeGreaterThan(
      classification.runnerUp?.totalScore ?? 0
    );
  });

  test("injects only the selected profile examples and an explicit conflict arbitration rule", () => {
    const prompt = buildThinReadingPromptGuidance({
      context: rootContext,
      evidencePrompt: "The evaluation suite includes a leaderboard, corpus collection protocol, and expert annotations.",
      selectedPaperTitle: "A Benchmark Dataset for Retrieval"
    });
    const benchmarkExamples = getThinReadingFewShotExamples("benchmark", "zh-CN");
    const datasetExamples = getThinReadingFewShotExamples("dataset", "zh-CN");

    for (const example of benchmarkExamples) {
      expect(prompt).toContain(example);
    }
    expect(prompt).not.toContain(datasetExamples[0]);
    expect(prompt).toContain("类型冲突：benchmark 与 dataset 分数接近");
    expect(prompt).toContain("不能按章节名或发表场景机械选择");
    expect(prompt).toContain("只借鉴取舍模式，不复制文案");
  });

  test("returns unknown with low confidence when neither title nor evidence has type signals", () => {
    const classification = classifyThinReadingPaperWithDiagnostics({
      evidencePrompt: "The paper discusses a topic and provides several observations.",
      title: "Notes on a Research Question"
    });

    expect(classification).toMatchObject({
      confidence: "low",
      conflict: false,
      paperType: "unknown"
    });
    expect(classification.winner).toBeUndefined();
  });
});
