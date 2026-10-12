import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

async function prepare(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: "导出为文档" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await expect(dialog.getByRole("button", { name: "生成预览" })).toBeEnabled();
  const consent = dialog.getByRole("checkbox", { name: "我已了解缺失资源与格式降级，继续导出" });
  if (await consent.isVisible()) { await consent.check(); await dialog.getByRole("button", { name: "生成预览" }).click(); }
  return dialog;
}
test("shared dialog downloads portable Markdown, standalone HTML and editable DOCX with honest browser receipts", async ({ page }) => {
  await page.goto("/?artifact-export-fixture");
  for (const [label, extension] of [["Markdown (.md)", "zip"], ["HTML (.html)", "html"], ["Word (.docx)", "docx"]]) {
    const dialog = await prepare(page, label);
    await expect(dialog.getByRole("button", { name: "保存本次文档" })).toBeEnabled();
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "保存本次文档" }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe(`QVLA 导出测试.${extension}`);
    const bytes = await readFile((await file.path())!);
    if (extension === "zip") { const files = unzipSync(bytes); expect(strFromU8(files["document.md"])).toContain("TAIL_EXPORT_MARKER"); expect(Object.keys(files).filter(path => path.startsWith("assets/")).length, strFromU8(files["manifest.json"])).toBeGreaterThanOrEqual(2); } else if (extension === "docx") {
      const files = unzipSync(bytes); expect(strFromU8(files["word/document.xml"])).toContain("TAIL_EXPORT_MARKER");
      expect(strFromU8(files["word/document.xml"])).toContain("<w:tbl>");
    } else {
      expect(bytes.toString("utf8")).toContain("QVLA 使用动作空间敏感度");
      expect(bytes.toString("utf8")).toContain("TAIL_EXPORT_MARKER");
      if (extension === "html") expect(bytes.toString("utf8")).toContain("<math");
    }
    await expect(page.getByText("已交给浏览器下载，保存位置由浏览器管理。")).toBeVisible();
  }
  const dialog = await prepare(page, "PDF (.pdf)");
  await expect(dialog.getByRole("button", { name: "系统打印" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "保存本次文档" })).toHaveCount(0);
});

test("production static HTML prints actual searchable PDF with upright image, tables, formulas and tail", async ({ page, browser }) => {
  await page.goto("/?artifact-export-fixture");
  const dialog = await prepare(page, "HTML (.html)");
  await expect(dialog.getByRole("button", { name: "保存本次文档" })).toBeEnabled();
  const downloaded = page.waitForEvent("download"); await dialog.getByRole("button", { name: "保存本次文档" }).click();
  const html = await readFile((await (await downloaded).path())!, "utf8");
  expect(html).toContain("Mermaid 图表"); expect(html).not.toContain("图表无法安全静态化");
  const print = await browser.newPage();
  await print.route("**/*", route => route.abort());
  await print.setContent(html);
  await print.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  const bytes = await print.pdf({ preferCSSPageSize: true, printBackground: true, scale: 1, tagged: true, outline: true });
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = "";
  for (let index = 1; index <= pdf.numPages; index++) { const content = await (await pdf.getPage(index)).getTextContent(); text += content.items.map(item => "str" in item ? item.str : "").join(""); }
  expect(text.normalize("NFKC").replace(/\s+/g, "")).toContain("QVLA使用动作空间敏感度");
  expect(text).toContain("TAIL_EXPORT_MARKER"); expect(text).toContain("CODE_LAST_LINE");
  expect(pdf.numPages).toBeGreaterThan(1);
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 }); expect(viewport.width).toBeCloseTo(595.28, 0); expect(viewport.height).toBeCloseTo(841.89, 0);
  if (process.env.EXPORT_EVIDENCE_DIR) {
    await mkdir(process.env.EXPORT_EVIDENCE_DIR, { recursive: true });
    await writeFile(resolve(process.env.EXPORT_EVIDENCE_DIR, "research-report.pdf"), bytes);
    await writeFile(resolve(process.env.EXPORT_EVIDENCE_DIR, "research-report.html"), html);
    await writeFile(resolve(process.env.EXPORT_EVIDENCE_DIR, "research-report.txt"), text);
    await writeFile(resolve(process.env.EXPORT_EVIDENCE_DIR, "browser-version.txt"), browser.version());
    await print.screenshot({ path: resolve(process.env.EXPORT_EVIDENCE_DIR, "research-report-browser.png"), fullPage: true });
  }
  await pdf.destroy(); await print.close();
});
