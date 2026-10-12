import { expect, test } from "vitest";
import { defaultReplaySpec, hypothesisDraftSchema, replaySpecSchema, researchReportMarkdown } from "../app/features/research-loop/researchHostClient";

test("bold speculative hypotheses can be proposed without a forged scientific verdict", () => {
  const input = { question: "尚未验证的新解释？", proposedMechanism: "可能成立的类比", changedAssumption: "先改变已知前提",
    nearestBaselines: [], applicabilityConditions: [], predictions: ["可检查预测"], falsificationCriteria: ["可能反例"], literatureRefs: [] };
  expect(hypothesisDraftSchema.parse(input).question).toContain("尚未验证");
  expect(hypothesisDraftSchema.safeParse({ ...input, audited: true, novelty: "proved", runId: "invented" }).success).toBe(false);
});
test("oracle, dropped samples and same-seed holdouts cannot enter an experiment proposal", () => {
  const input = defaultReplaySpec({ validatorVersion: "v1", codeSnapshot: "a".repeat(64) });
  expect(replaySpecSchema.parse(input).candidate).toBe("sequential");
  expect(replaySpecSchema.safeParse({ ...input, candidate: "oracle" }).success).toBe(false);
  expect(replaySpecSchema.safeParse({ ...input, candidate: "omit_samples" }).success).toBe(false);
  expect(replaySpecSchema.safeParse({ ...input, holdoutSeed: input.trainSeed }).success).toBe(false);
});
test("capability data cannot silently add native-only permissions to the replay spec", () => {
  const input = defaultReplaySpec({ validatorVersion: "v1", codeSnapshot: "a".repeat(64), arbitraryCodeExecution: true } as any);
  expect(input).not.toHaveProperty("arbitraryCodeExecution");
});
test("failed and cancelled runs remain in the exported evidence narrative", () => {
  const report = researchReportMarkdown({ task: { goal: "检查问题", taskId: "task" } as any,
    records: [], runs: [{ runId: "failed-run", status: "failed", error: "actual failure", specId: "fixed-spec", specHash: "hash" } as any] });
  expect(report).toContain("actual failure"); expect(report).toContain("failed-run");
  expect(report).toContain("不代表 GPU 训练提速或新颖性");
});
