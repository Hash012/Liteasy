import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { evidenceReportFromAssetReads } from "../app/features/evidence/evidenceAdapters";
import { EvidenceLens } from "../app/features/evidence/components/EvidenceLens";
import { readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
const fixture = (name: string) => readFileSync(`../../../../development/test-data/unified-content/${name}`, "utf8");
const asset = { path: "liteasy://objects/memo?scope=local", title: "合成研究笔记", kind: "content.note", revision: "r1", capabilities: [] };

test("shared evidence body renders merged HTML table headers", () => {
  const report = evidenceReportFromAssetReads({ id: "r", answer: "", scopeId: "local", reads: [readAgentAssetText(asset, fixture("mixed-content.md"), {})] });
  const { container } = render(<EvidenceLens report={report} />);
  fireEvent.click(screen.getByRole("button", { name: /1 篇来源/ }));
  expect(container.querySelector("th[colspan='2']")).toHaveTextContent("编辑指标");
});
test("evidence preserves the full fetched payload past the old 4000 character boundary", () => {
  const read = readAgentAssetText(asset, fixture("long-table.md"), { maxCharacters: 80000 });
  const report = evidenceReportFromAssetReads({ id: "r", answer: "", scopeId: "local", reads: [read] });
  expect(report.passages[0].quote).toBe(read.text);
});

test("selection inside an HTML attribute preserves exact quote and expands only display context", () => {
  const text = fixture("mixed-content.md");
  const offset = text.indexOf('colspan="2"') + 3;
  const read = readAgentAssetText(asset, text, { offset, maxCharacters: 20 });
  expect(read.text).toBe(text.slice(offset, offset + 20));
  expect(read.content.exactSelection.text).toBe(read.text);
  expect(read.content.viewContext.text).toContain("<table>");
  expect(read.content.viewContext.text).toContain("</table>");
  expect(read.content.viewContext.materialBeyondSelection).toBe(true);
  expect(read.content.mapping).toBe("exact-utf16");
});
test("never splits surrogate pairs and retains original CRLF offsets", () => {
  const text = "a\r\n😀b";
  const read = readAgentAssetText(asset, text, { maxCharacters: 4 });
  expect(read.text).toBe("a\r\n");
  expect(read.nextOffset).toBe(3);
  expect(read.content.exactSelection.ranges[0]).toEqual({ start: 0, end: 3, unit: "utf16" });
});
