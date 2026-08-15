import { describe, expect, test } from "vitest";
import type { AnalysisEvidence } from "../app/features/paper-analysis/analysis.types";
import {
  assertThinReadingNumericFidelity,
  ThinReadingNumericFidelityError
} from "../app/features/thin-reading/thinReadingNumericFidelity";

function evidence(quote: string): AnalysisEvidence {
  return { id: "evidence-time", quote } as AnalysisEvidence;
}

function check(output: string, source: string) {
  return () => assertThinReadingNumericFidelity({
    analysisEvidence: [evidence(source)],
    externalSources: [],
    sentences: [{
      evidenceIds: ["evidence-time"],
      externalKnowledge: [],
      text: output
    }]
  });
}

describe("thinReadingNumericFidelity", () => {
  test("rejects conflicting Chinese time units with the same raw value", () => {
    expect(check("每轮训练耗时 1 秒。", "每轮训练耗时 1 分钟。"))
      .toThrow(ThinReadingNumericFidelityError);
  });

  test("accepts an equivalent Chinese time-unit conversion", () => {
    expect(check("每轮训练耗时 60 秒。", "每轮训练耗时 1 分钟。"))
      .not.toThrow();
  });
});
