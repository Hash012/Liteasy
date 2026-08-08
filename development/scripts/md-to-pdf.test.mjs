import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildPrintableHtml,
  getDefaultOutputPath,
  parseCliArgs
} from "./md-to-pdf-lib.mjs";

test("buildPrintableHtml renders mermaid fences as mermaid diagram containers", () => {
  const html = buildPrintableHtml({
    inputPath: "/tmp/agent-audit.md",
    markdown: [
      "# Agent Audit",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[Start] --> B[Done]",
      "```"
    ].join("\n"),
    mermaidModuleUrl: "file:///tmp/mermaid.esm.min.mjs"
  });

  assert.match(html, /<div class="mermaid">/);
  assert.match(html, /flowchart TD/);
  assert.doesNotMatch(html, /```mermaid/);
  assert.match(html, /window\.__liteasyMermaidReady/);
});

test("buildPrintableHtml renders tables and preserves Chinese text", () => {
  const html = buildPrintableHtml({
    inputPath: "/tmp/audit.md",
    markdown: [
      "# 审计",
      "",
      "| 模块 | 功能 |",
      "|---|---|",
      "| agent-core | 上下文治理 |"
    ].join("\n"),
    mermaidModuleUrl: "file:///tmp/mermaid.esm.min.mjs"
  });

  assert.match(html, /<table>/);
  assert.match(html, /<th>模块<\/th>/);
  assert.match(html, /<td>上下文治理<\/td>/);
});

test("getDefaultOutputPath changes markdown extension to pdf beside the source", () => {
  assert.equal(
    getDefaultOutputPath("docs/engineering/agent-architecture-audit.md"),
    path.normalize("docs/engineering/agent-architecture-audit.pdf")
  );
});

test("parseCliArgs accepts input plus explicit output", () => {
  assert.deepEqual(
    parseCliArgs(["docs/input.md", "--output", "build/input.pdf"]),
    {
      inputPath: "docs/input.md",
      outputPath: "build/input.pdf"
    }
  );
});
