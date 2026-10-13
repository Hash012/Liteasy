import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

test("real print preserves rich content, repeated table headers, code and bounded wide formula source", async ({ page, browser }, info) => {
  const rich = await readFile(resolve("../../../../development/test-data/document-export/ui-root-cause-rich.md"), "utf8");
  const formula = Array.from({ length: 50 }, (_, index) => `x_{${index}}`).join("+");
  const rows = Array.from({ length: 100 }, (_, index) => `| ROW-${String(index).padStart(3, "0")} | 合成记录 ${index} |`).join("\n");
  const source = `${rich}\n\n## 连续表格\n\n| 行编号 | 合成内容 |\n|---|---|\n${rows}\n\n## WIDE-FORMULA-HEADING\n\n$$\n${formula}\n$$\n\nPRINT-END-MARKER`;
  await page.goto("/src/tests/browser/fixtures/document-semantics.html");
  await page.waitForFunction(() => "compilePrintFixture" in window);
  const result = await page.evaluate((source) => (window as any).compilePrintFixture(source), source);
  expect(result.diagnostics.some((issue: { code: string }) => issue.code === "wide_math_source")).toBe(true);
  const print = await browser.newPage();
  await print.route("**/*", route => route.abort());
  await print.setContent(result.html);
  await print.evaluate(() => document.fonts.ready);
  await print.emulateMedia({ media: "print" });
  expect(await print.locator(".export-math-wide > .katex").evaluate(el => getComputedStyle(el).display)).toBe("none");
  const bytes = await print.pdf({ preferCSSPageSize: true, printBackground: true, scale: 1, tagged: true });
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const pdfPage = await pdf.getPage(index), content = await pdfPage.getTextContent();
    pages.push(content.items.map(item => "str" in item ? item.str : "").join(""));
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      expect(item.transform[4], `page ${index}: ${item.str}`).toBeGreaterThanOrEqual(35);
      expect(item.transform[4] + item.width, `page ${index}: ${item.str}`).toBeLessThan(570);
      expect(item.transform[5], `page ${index}: ${item.str}`).toBeGreaterThan(35);
    }
  }
  const text = pages.join("\n").normalize("NFKC");
  for (let index = 0; index < 100; index++) expect(text).toContain(`ROW-${String(index).padStart(3, "0")}`);
  expect(text).toContain("std::fs::read(path)"); expect(text).toContain("END-OF-SYNTHETIC-DOCUMENT"); expect(text).toContain("PRINT-END-MARKER");
  expect(text).toContain("脚注内容为合成文本");
  expect(text.replace(/\s/g, "")).toContain(formula);
  const tablePages = pages.filter(text => /ROW-\d/.test(text));
  expect(tablePages.length).toBeGreaterThan(1);
  for (const text of tablePages) expect(text.normalize("NFKC")).toMatch(/表头\(跨[页⻚]重复\)/);
  const headingPage = pages.find(text => text.includes("WIDE-FORMULA-HEADING"));
  expect(headingPage).toContain("完整公式源码");
  await writeFile(info.outputPath("rich-print.pdf"), bytes);
  await writeFile(info.outputPath("rich-print.html"), result.html);
  await writeFile(info.outputPath("rich-print.txt"), text);
  await writeFile(info.outputPath("environment.json"), JSON.stringify({ browser: browser.version(), platform: process.platform, pageCount: pdf.numPages, sourceCommit: "pending root commit", mode: "Vite real HTML renderer + headless Chromium PDF (not Windows WebView)", diagnostics: result.diagnostics }, null, 2));
  await print.screenshot({ path: info.outputPath("rich-print.png"), fullPage: true });
  await pdf.destroy(); await print.close();
});
