import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { evidenceReportFromAssetReads } from "../app/features/evidence/evidenceAdapters";
import { EvidenceLens } from "../app/features/evidence/components/EvidenceLens";
import { readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
const fixture = (name: string) => readFileSync(`../../../../development/test-data/unified-content/${name}`, "utf8");
const asset = { path: "liteasy://objects/memo?scope=local", title: "合成研究笔记", kind: "content.note", revision: "r1", capabilities: [] };

test.fails("shared evidence body renders merged HTML table headers", () => {
  const report = evidenceReportFromAssetReads({ id: "r", answer: "", scopeId: "local", reads: [readAgentAssetText(asset, fixture("mixed-content.md"), {})] });
  const { container } = render(<EvidenceLens report={report} />);
  fireEvent.click(screen.getByRole("button", { name: /1 篇来源/ }));
  expect(container.querySelector("th[colspan='2']")).toHaveTextContent("编辑指标");
});
test.fails("evidence preserves the full fetched payload past the old 4000 character boundary", () => {
  const read = readAgentAssetText(asset, fixture("long-table.md"), { maxCharacters: 80000 });
  const report = evidenceReportFromAssetReads({ id: "r", answer: "", scopeId: "local", reads: [read] });
  expect(report.passages[0].quote).toBe(read.text);
});
