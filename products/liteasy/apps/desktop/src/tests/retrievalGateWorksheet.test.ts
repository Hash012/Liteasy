import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  evaluateRetrievalGate,
  formatRetrievalGateReport,
  parseRetrievalGateWorksheet
} from "../app/features/retrieval/retrievalGateMetrics";

const worksheetPath = process.env.LITEASY_RETRIEVAL_GATE_WORKSHEET;
const gateTest = worksheetPath ? test : test.skip;

/**
 * The gate itself. Point LITEASY_RETRIEVAL_GATE_WORKSHEET at a labeled worksheet (produced
 * by scripts/retrieval-gate-sample.mjs) and this fails until retrieval is good enough to
 * build the anchor association UI on top of.
 */
gateTest("labeled retrieval sample clears the precision gate", () => {
  const worksheet = JSON.parse(readFileSync(worksheetPath as string, "utf8"));
  expect(
    worksheet.retrievalGateProtocolVersion,
    "工作表来自旧检索协议；请用当前 gate:retrieval-sample 重新抽样并人工标注。"
  ).toBe(2);
  expect(
    worksheet.anchorReferenceMode,
    "工作表不是锚点局部引用模式；整篇论文引用图的标签不能验证当前实现。"
  ).toBe("exclusive");
  const parsed = parseRetrievalGateWorksheet(worksheet);
  const report = evaluateRetrievalGate(parsed.samples);

  // Printed either way: the numbers are the point, not just the verdict.
  process.stdout.write(`\n${formatRetrievalGateReport(report)}\n`);

  expect(
    parsed.unlabeled,
    `还有 ${parsed.unlabeled.length} 条未打标：${parsed.unlabeled.slice(0, 10).join("、")}`
  ).toEqual([]);
  expect(report.shortfalls, report.shortfalls.join(" / ")).toEqual([]);
  expect(report.passed).toBe(true);
});
