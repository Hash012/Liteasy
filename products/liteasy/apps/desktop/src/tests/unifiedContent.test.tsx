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

import { ContentView } from "../app/features/markdown/ContentView";
import { legacyContent } from "../app/features/markdown/contentFragment";
import { sourceContent } from "../app/features/markdown/contentStructure";
import { selectContextText } from "../app/features/context/contextSelection";
import { AssistantMarkdown } from "../app/features/assistant/AssistantMarkdown";
import { RichTextBlock } from "../app/features/visual-blocks/VisualBlockBase";

test.each(["reader", "chat", "whiteboard", "evidence"])("%s preserves safe cells, caption, math and literal code", surface => {
  const text = fixture("mixed-content.md").replace(/```mermaid[\s\S]*?```/, "");
  const fragment = sourceContent({ text, path: asset.path, revision: asset.revision, scopeId: "local" });
  const { container } = render(surface === "chat" ? <AssistantMarkdown value={text} /> : surface === "whiteboard" ? <RichTextBlock text={text} /> : <ContentView content={fragment} purpose={surface === "evidence" ? "evidence" : "reading"} />);
  expect(container.querySelectorAll("table")).toHaveLength(2);
  expect(container.querySelector("caption")).toHaveTextContent("只用于显示测试");
  expect(container.querySelector("th[rowspan='2']")).toHaveTextContent("方法");
  expect(container.querySelector(".katex")).not.toBeNull();
  expect(container.querySelector("code.language-html")).toHaveTextContent("<table>");
});
test("safe tables and links survive while script, event, local URLs, styles and remote preview media do not", () => {
  const { container } = render(<ContentView purpose="evidence" content={legacyContent('<table style="position:fixed"><caption>Safe</caption><tr><td onclick="alert(1)">7</td></tr></table>\n\n[OK](https://example.org) [NO](file:///etc/passwd)\n\n<img src="https://tracker.example/pixel"><script>alert(1)</script><iframe src="https://example.org"></iframe>')} />);
  expect(container.querySelector("td")).toHaveTextContent("7");
  expect(container.querySelector('a[href="https://example.org"]')).not.toBeNull();
  expect(container.querySelector("script,iframe,img,[onclick],table[style],a[href^='file:']")).toBeNull();
});
test("incomplete source and huge single blocks downgrade explicitly, never invent missing markup", () => {
  const incomplete = fixture("incomplete-html-table.txt");
  const old = legacyContent(incomplete);
  expect(old.integrity).toBe("incomplete-snapshot");
  expect(old.exactSelection.text).toBe(incomplete);
  const text = fixture("long-table.md");
  const content = sourceContent({ text, path: asset.path, revision: "r1", scopeId: "local", start: 400, end: 420, maxViewCharacters: 100 });
  expect(content.integrity).toBe("budget-exceeded");
  expect(content.viewContext.text).toBe(text.slice(400, 420));
  const selected = selectContextText(text, 50);
  expect(selected.text).not.toContain("<table");
  expect(selected.coverage.status).not.toBe("full");
});
test("fragment dependencies stay in the same original revision and source view never changes the quote", () => {
  const text = fixture("mixed-content.md");
  const start = text.indexOf("这句话");
  const content = sourceContent({ text, path: asset.path, revision: "r1", scopeId: "local", start, end: start + 8 });
  expect(content.viewContext.text).toContain("[^scope]:");
  expect(content.viewContext.text).toContain("[note]:");
  expect(content.exactSelection.text).toBe(text.slice(start, start + 8));
  render(<ContentView content={content} allowSource />);
  fireEvent.click(screen.getByRole("button", { name: "查看源码" }));
  expect(screen.getByText(text.slice(start, start + 8))).toBeVisible();
});

test("valid reference definitions and footnotes retain link semantics in fragments", () => {
  const text = "Intro\n\nSee [source][ref] and a note[^n].\n\nOther\n\n[ref]: https://example.org/source\n\n[^n]: precise condition\n";
  const start = text.indexOf("See ");
  const content = sourceContent({ text, path: asset.path, revision: "r1", scopeId: "local", start, end: start + 5 });
  const { container } = render(<ContentView content={content} />);
  expect(container.querySelector('a[href="https://example.org/source"]')).toHaveTextContent("source");
  expect(container.querySelector(".footnotes, [data-footnotes]")).toHaveTextContent("precise condition");
});

test("fragment segment offsets refer to original CRLF text even with appended definitions", () => {
  const text = "before\r\n\r\nSee [x][ref].\r\n\r\nother\r\n\r\n[ref]: https://example.org\r\n";
  const start = text.indexOf("See");
  const content = sourceContent({ text, path: asset.path, revision: "r1", scopeId: "local", start, end: start + 3 });
  for (const segment of content.viewContext.segments!) {
    expect(content.viewContext.text.slice(segment.outputStart, segment.outputEnd)).toBe(text.slice(segment.sourceRange.start, segment.sourceRange.end));
  }
});
test("streaming and normalized math disclose draft state and unavailable source mapping", () => {
  const { container } = render(<ContentView content={legacyContent('\\(x+1\\)\n\n```html\n<table>')} streaming />);
  expect(screen.getByText("生成中，内容尚未完整")).toBeVisible();
  expect(container.querySelector('[data-source-mapping="unavailable"]')).not.toBeNull();
  expect(container.querySelector('[data-source-line]')).toBeNull();
});


test("safe HTML table header references survive sanitizer ID prefixing", () => {
  const { container } = render(<ContentView content={legacyContent('<table><tr><th id="metric">Metric</th></tr><tr><td headers="metric">7</td></tr></table>')} />);
  expect(container.querySelector("th")?.id).toBe("user-content-metric");
  expect(container.querySelector("td")?.getAttribute("headers")).toBe(container.querySelector("th")?.id);
});
test("giant sources use a bounded structural fallback without pretending a slice is a complete block", () => {
  const text = "z".repeat(2_000_001);
  const content = sourceContent({ text, path: asset.path, revision: "r1", scopeId: "local", start: 10, end: 20 });
  expect(content.exactSelection.text).toBe("z".repeat(10));
  expect(content.integrity).toBe("budget-exceeded");
  expect(content.viewContext.text).toBe(content.exactSelection.text);
});
