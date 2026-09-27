import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });
test("bookmarks, page overview and annotation overview navigate real PDF pages", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const content = "BT /F1 18 Tf 40 240 Td (Abstract: Paper annotation example.) Tj ET";
  const pdfPage = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R /Names << /Dests << /Names [(middle) [7 0 R /FitH 150]] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R 8 0 R] /Count 4 >>", pdfPage,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, pdfPage, pdfPage, pdfPage,
    "<< /Type /Outlines /First 10 0 R /Last 12 0 R /Count 3 >>",
    "<< /Title (Chapter One) /Parent 9 0 R /Dest [3 0 R /Fit] /First 11 0 R /Last 11 0 R /Count 1 /Next 12 0 R >>",
    "<< /Title (Named Section) /Parent 10 0 R /Dest (middle) >>",
    "<< /Title (Last Chapter) /Parent 9 0 R /Prev 10 0 R /Dest [8 0 R /Fit] >>"
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = source.length; source += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: Buffer.from(source), contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/?pdf-highlight-fixture#navigation");
  await expect(page.locator('.pdf-page-shell[data-page="4"] .pdf-text-layer')).toContainText("Abstract", { timeout: 30_000 });
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: "Named Section", exact: true }).click();
  await expect(page.getByLabel("当前页码")).toHaveValue("3");
  const thumbnails = page.getByRole("button", { name: "缩略图", exact: true });
  await thumbnails.dblclick();
  const pages = page.getByRole("region", { name: "全部页面缩略图" });
  await expect(pages).toBeVisible();
  await expect(page.getByLabel("PDF.js 页面列表")).toHaveCount(0);
  const canvas = pages.getByLabel("PDF.js 缩略图 3");
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.width)).toBeGreaterThanOrEqual(320);
  await expect.poll(async () => {
    const first = (await pages.getByLabel("PDF.js 缩略图 1").boundingBox())!;
    const fourth = (await pages.getByLabel("PDF.js 缩略图 4").boundingBox())!;
    return fourth.y - first.y;
  }).toBeLessThan(200);
  await pages.screenshot({ path: testInfo.outputPath("pages-overview.png") });
  await pages.getByRole("button", { name: "转到第 1 页", exact: true }).click();
  await expect(page.getByLabel("当前页码")).toHaveValue("1");
  const text = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer');
  await expect(text).toContainText("Abstract");
  await expect.poll(async () => {
    const stage = (await page.getByLabel("PDF 页面滚动区").boundingBox())!;
    const first = (await text.boundingBox())!;
    return Math.abs(first.y - stage.y);
  }).toBeLessThan(20);
  const bounds = (await text.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .102, bounds.y + bounds.height * .18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .275, bounds.y + bounds.height * .18, { steps: 10 });
  await page.mouse.up();
  await page.getByLabel("选中文本批注菜单").getByRole("button", { name: "高亮", exact: true }).click();
  await page.getByRole("button", { name: "批注", exact: true }).dblclick();
  const notes = page.getByRole("region", { name: "全部批注" });
  await expect(notes).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("liteasy:appearance-change", { detail: "dark" })));
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await expect(notes.locator("blockquote")).toContainText("Abstract");
  await notes.screenshot({ path: testInfo.outputPath("annotations-overview.png") });
  await notes.getByRole("button", { name: /定位第 1 页高亮/ }).click();
  await expect(page.locator("button.pdf-overlay-mark.highlight")).toBeVisible();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: "Last Chapter", exact: true }).click();
  await expect(page.getByLabel("当前页码")).toHaveValue("4");
  await thumbnails.dblclick();
  await pages.getByRole("button", { name: "转到第 3 页", exact: true }).click();
  await expect(page.getByLabel("当前页码")).toHaveValue("3");
  await expect.poll(async () => {
    const stage = (await page.getByLabel("PDF 页面滚动区").boundingBox())!;
    const third = (await page.locator('.pdf-page-shell[data-page="3"]').boundingBox())!;
    return Math.abs(third.y - stage.y);
  }).toBeLessThan(20);
});
