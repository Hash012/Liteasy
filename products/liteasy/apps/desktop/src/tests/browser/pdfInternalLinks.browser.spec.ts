import { expect, test } from "@playwright/test";

function linkedPdf() {
  const content = "BT /F1 18 Tf 40 610 Td (Chapter link) Tj 0 -210 Td (Middle text) Tj ET";
  const page = (annotations = "") => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 700] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R ${annotations} >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(chapter) [6 0 R /XYZ 0 350 null]] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] /Count 3 >>", page("/Annots [8 0 R]"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, page("/Annots [9 0 R]"), page(),
    "<< /Type /Annot /Subtype /Link /Rect [40 600 160 630] /Border [0 0 0] /Dest (chapter) >>",
    "<< /Type /Annot /Subtype /Link /Rect [40 390 160 420] /Border [0 0 0] /A << /S /GoTo /D [7 0 R /Fit] >> >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = source.length; source += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = source.length;
  return Buffer.from(source + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

test("real PDF internal links share previews, navigate named/explicit destinations and obey saved sizes", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: linkedPdf(), contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/?pdf-highlight-fixture#internal-links");
  const link = page.locator('.pdf-page-shell[data-page="1"]').getByRole("link", { name: "跳转到 PDF 内部位置" });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.hover();
  const preview = page.getByLabel("原始 PDF 预览", { exact: true });
  await expect(preview.getByLabel("原始 PDF 第 2 页")).toBeVisible();
  const popup = page.getByLabel("引用内容预览", { exact: true });
  await expect.poll(async () => (await popup.boundingBox())!.width).toBeCloseTo(720, 0);
  await expect.poll(() => preview.locator(".source-pdf-stage").evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await expect(page.getByLabel("当前页码")).toHaveValue("1");
  await link.click();
  await expect(page.getByLabel("当前页码")).toHaveValue("2");
  await expect(preview).toHaveCount(0);
  await expect.poll(() => page.getByLabel("PDF 页面滚动区").evaluate(stage => {
    const target = stage.querySelector('.pdf-page-shell[data-page="2"]')!.getBoundingClientRect();
    return Math.abs(target.top + target.height * .5 - stage.getBoundingClientRect().top);
  })).toBeLessThan(20);
  const next = page.locator('.pdf-page-shell[data-page="2"]').getByRole("link");
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("当前页码")).toHaveValue("3");
  // The actual settings store reads this preference again on reload.
  await page.evaluate(() => localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.pdf_preview_scale": "100" })));
  await page.reload();
  const pageInput = page.getByLabel("当前页码");
  await pageInput.fill("1"); await pageInput.press("Enter");
  await link.hover();
  await expect(preview.getByLabel("原始 PDF 第 2 页")).toBeVisible();
  await expect.poll(async () => (await popup.boundingBox())!.width).toBeCloseTo(480, 0);
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(async () => {
    const box = (await popup.boundingBox())!;
    return box.width <= 768 && box.height <= 668;
  }).toBe(true);
});
