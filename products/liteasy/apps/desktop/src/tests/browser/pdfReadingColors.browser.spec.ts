import { expect, test } from "@playwright/test";

function colorPdf() {
  const content = "BT /F1 24 Tf 30 260 Td (Night reading) Tj ET\nq 100 0 0 100 100 100 cm /Im1 Do Q";
  const image = "FFFFFF000000FF0000808080>";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = source.length; source += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}

test("PDF page colors change actual pixels, preserve raster images and persist custom choices", async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: colorPdf(), contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/?pdf-highlight-fixture#colors");
  const canvas = page.locator('.pdf-page-shell[data-page="1"] canvas.pdf-page-canvas');
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).toContainText("Night reading");
  const pixel = (x: number, y: number) => canvas.evaluate((node, point) => {
    const c = node as HTMLCanvasElement;
    if (!c.width || !c.height) return [];
    return [...c.getContext("2d")!.getImageData(Math.floor(point[0] / 400 * c.width), Math.floor(point[1] / 300 * c.height), 1, 1).data].slice(0, 3);
  }, [x, y]);
  await expect.poll(() => pixel(380,280)).toEqual([255,255,255]);
  const originalImage = await Promise.all([[125,125], [175,125], [125,175], [175,175]].map(([x,y]) => pixel(x,y)));
  expect(originalImage).toEqual([[255,255,255],[0,0,0],[255,0,0],[128,128,128]]);
  await page.getByRole("button", { name: "PDF 阅读配色", exact: true }).click();
  await page.getByRole("combobox", { name: "PDF 页面配色" }).selectOption("night");
  await expect.poll(() => pixel(380,280)).toEqual([32,37,42]);
  await expect.poll(async () => Promise.all([[125,125], [175,125], [125,175], [175,175]].map(([x,y]) => pixel(x,y)))).toEqual(originalImage);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("pdf-night-original-images.png") });
  await page.getByRole("button", { name: "PDF 阅读配色", exact: true }).click();
  await page.getByRole("combobox", { name: "PDF 页面配色" }).selectOption("mint");
  await expect.poll(() => pixel(380,280)).toEqual([237,248,236]);
  await page.getByRole("combobox", { name: "PDF 页面配色" }).selectOption("custom");
  await page.getByRole("textbox", { name: "自定义 PDF 页面颜色" }).fill("#f2e4c8");
  await expect.poll(() => pixel(380,280)).toEqual([242,228,200]);
  await page.reload();
  await expect.poll(() => pixel(380,280)).toEqual([242,228,200]);
  await page.getByRole("button", { name: "PDF 阅读配色", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "PDF 页面配色" })).toHaveValue("custom");
  await page.getByRole("combobox", { name: "PDF 页面配色" }).selectOption("night");
  await page.getByRole("checkbox", { name: "保留图片原色", exact: true }).uncheck();
  await expect.poll(() => pixel(125,125)).toEqual([32,37,42]);
  await expect.poll(() => pixel(175,125)).toEqual([226,230,234]);
  await page.getByRole("combobox", { name: "PDF 页面配色" }).selectOption("paper");
  await expect.poll(() => pixel(380,280)).toEqual([255,255,255]);
  expect(errors).toEqual([]);
});
