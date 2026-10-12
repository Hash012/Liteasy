import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import { objectRefSchema } from "../objects/objectAnchor.types";

export const researchTaskStateSchema = z.enum(["running", "waiting_user", "waiting_job", "interrupted", "exhausted", "completed"]);
export const hypothesisStatusSchema = z.enum(["speculative", "testable", "supported_under_conditions", "refuted", "inconclusive"]);
export const hypothesisDraftSchema = z.strictObject({
  question: z.string().trim().min(1).max(4000),
  proposedMechanism: z.string().trim().min(1).max(8000),
  changedAssumption: z.string().trim().min(1).max(4000),
  nearestBaselines: z.array(z.string().max(4000)).max(8),
  applicabilityConditions: z.array(z.string().max(4000)).max(12),
  predictions: z.array(z.string().min(1).max(4000)).min(1).max(12),
  falsificationCriteria: z.array(z.string().min(1).max(4000)).min(1).max(12),
  literatureRefs: z.array(objectRefSchema).max(12),
});
export const replaySpecSchema = z.strictObject({
  candidate: z.enum(["sequential", "last_delta"]),
  cacheBytes: z.number().int().min(1).max(64 * 1024 * 1024),
  sampleBytes: z.number().int().min(1).max(1024 * 1024),
  ioUs: z.number().int().min(1).max(1_000_000),
  computeUs: z.number().int().min(0).max(1_000_000),
  samples: z.number().int().min(16).max(20000),
  trainSeed: z.number().int().min(0).max(0xffffffff),
  holdoutSeed: z.number().int().min(0).max(0xffffffff),
  validatorVersion: z.string().min(1),
  codeSnapshot: z.string().regex(/^[0-9a-f]{64}$/),
}).refine(value => value.trainSeed !== value.holdoutSeed, "独立检查必须使用不同种子")
  .refine(value => value.cacheBytes >= value.sampleBytes, "缓存必须容纳至少一个完整样本");
export type ReplaySpec = z.infer<typeof replaySpecSchema>;
export type ResearchProjectTask = {
  schema: "liteasy.research-task/v1";
  taskId: string;
  projectRef: z.infer<typeof objectRefSchema>;
  parentSessionRef?: string;
  goal: string;
  state: z.infer<typeof researchTaskStateSchema>;
  activeHypothesisRefs: Array<{ id: string; hash: string }>;
  checkpointRevision: number;
  budget: { maxRuns: number; usedRuns: number; maxRunnerSeconds: number };
  taskBrief: { nextCheck: string };
};
export type ResearchRecord = { id: string; hash: string; kind: string; body: Record<string, unknown> };
export type ExperimentRun = {
  runId: string; taskId: string; specId: string; specHash: string; attemptId: string; jobId: string;
  status: "submitting" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "exhausted";
  origin: "host_measured";
  resultHash?: string;
  error?: string;
  cost?: { externalCalls: number; networkBytes: number; runnerWallUs?: number | null; measurement?: string };
  rawResult?: {
    correctnessPassed: boolean; conditionalStatus: string; conditions: string[];
    validatorVersion: string; codeSnapshot: string;
    trace: string[]; holdoutTrace: string[]; negativeTrace?: string[];
    outputs: Array<{ workload: string; algorithm: string; correctness: boolean; traceSha256: string;
      metrics: { simulatedWaitP50Us: number; simulatedWaitP95Us: number; simulatedWaitTotalUs: number;
        simulatedElapsedUs: number; simulatedSamplesPerSecond: number; readAmplification: number;
        ioReadBytes: number; cachePeakBytes: number; replayWallUs: number } }>;
  };
};
export type ResearchTaskDetail = { task: ResearchProjectTask; records: ResearchRecord[]; runs: ExperimentRun[] };
export type ResearchHostPort = { call<T>(operation: string, payload?: unknown): Promise<T> };

export function createResearchHostClient(scope: string, active: () => boolean, transport = invoke): ResearchHostPort {
  return {
    async call<T>(operation: string, payload: unknown = {}) {
      if (!active()) throw new Error("账号或权限已变化，请重新打开研究项目。");
      if (!isTauri() && transport === invoke) throw new Error("研究实验需要桌面宿主；浏览器当前不提供实验执行。");
      const value = await transport<T>("research_host_command", { scope, operation, payload });
      if (!active()) throw new Error("账号或权限已变化，未沿用旧授权。");
      return value;
    },
  };
}
export function defaultReplaySpec(capability: { validatorVersion: string; codeSnapshot: string }, candidate: ReplaySpec["candidate"] = "sequential"): ReplaySpec {
  return { candidate, cacheBytes: 32768, sampleBytes: 4096, ioUs: 2000, computeUs: 3000,
    samples: 256, trainSeed: 11, holdoutSeed: 37, validatorVersion: capability.validatorVersion, codeSnapshot: capability.codeSnapshot };
}
export function researchReportMarkdown(detail: ResearchTaskDetail): string {
  const rows = detail.runs.flatMap(run => run.rawResult?.outputs.map(output =>
    "| " + [run.runId, output.workload, output.algorithm, output.metrics.simulatedWaitP50Us, output.metrics.simulatedWaitP95Us,
      output.metrics.readAmplification.toFixed(3), output.metrics.cachePeakBytes, output.metrics.replayWallUs,
      output.correctness ? "通过" : "失败"].join(" | ") + " |") ?? []);
  const fence = String.fromCharCode(96).repeat(3);
  const table = ["| 运行 | 工作负载 | 算法 | 模拟等待 P50 μs | 模拟等待 P95 μs | 读取放大 | 缓存峰值字节 | 回放实际耗时 μs | 正确性 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
  return ["# " + detail.task.goal, "本报告中的等待时间和吞吐来自合成 CPU trace 回放，不代表 GPU 训练提速或新颖性。",
    "## 假设", ...detail.records.filter(record => record.kind === "hypothesis").map(record =>
      "### " + String(record.body.question) + "\n\n状态：推测\n\n机制：" + String(record.body.proposedMechanism)
      + "\n\n变化的假设：" + String(record.body.changedAssumption) + "\n\n预测：" + (record.body.predictions as string[]).join("；")
      + "\n\n证伪条件：" + (record.body.falsificationCriteria as string[]).join("；")),
    "## 固定来源", ...detail.records.filter(record => record.kind === "spec").map(record => fence + "json\n" + JSON.stringify({ specId: record.id, sourceBindings: record.body.sourceBindings, literaturePacket: record.body.literaturePacket }, null, 2) + "\n" + fence),
    "## 实验对照", table,
    "## 原始运行与限制", ...detail.runs.map(run =>
      "### " + run.runId + "\n\n状态：" + run.status + "\n\n固定规格：" + run.specId + " / " + run.specHash
      + "\n\n实际结果哈希：" + (run.resultHash ?? "未生成") + "\n\n" + (run.error ?? "") + "\n\n"
      + "宿主运行成本：" + (run.cost ? JSON.stringify(run.cost) : "未测量") + "\n\n"
      + (run.rawResult?.conditions.map(value => "- " + value).join("\n") ?? "")),
    "## 推理执行与成本", "缺少供应商用量或费用时保留未测量；失败、中断与取消仍保留。",
    ...detail.records.filter(record => record.kind === "backend_terminal" || record.kind === "harness_receipt").map(record =>
      fence + "json\n" + JSON.stringify(record.body, null, 2) + "\n" + fence),
    "## 决策与主张", ...detail.records.filter(record => ["claim", "decision", "review"].includes(record.kind)).map(record =>
      "### " + record.kind + " " + record.id + "\n\n" + fence + "json\n" + JSON.stringify(record.body, null, 2) + "\n" + fence),
  ].join("\n\n");
}
