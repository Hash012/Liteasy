import { expect, test } from "@playwright/test";
test("same instance renders different page pixels after replacing equal-length real PDFs", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/export-preview.html");
  const canvas = page.getByLabel("本次实际生成的 PDF 页面");
  await expect.poll(() => canvas.evaluate(e => (e as HTMLCanvasElement).width)).toBeGreaterThan(300);
  await expect(page.getByText("第 1 / 10 页", { exact: true })).toBeVisible();
  // Wait until PDF.js has painted nonwhite glyph pixels, not merely allocated the canvas.
  const fingerprint = () => canvas.evaluate(e => {
    const c = e as HTMLCanvasElement, ctx = c.getContext("2d")!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i] < 100) ink++;
    return { ink, png: c.toDataURL() };
  });
  await expect.poll(async () => (await fingerprint()).ink).toBeGreaterThan(100);
  const before = (await fingerprint()).png;
  await page.getByRole("button", { name: "来源 B", exact: true }).click();
  await expect.poll(async () => (await fingerprint()).png).not.toBe(before);
  await expect(page.getByLabel("第 1 页文字")).toContainText("SOURCE_B_PAGE_1");
  await page.screenshot({ path: info.outputPath("source-b.png") });
});
for (const dpr of [1, 1.25, 1.5, 2]) test(`real PDF.js text and backing dimensions at DPR ${dpr}`, async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  try {
    await page.goto(`${test.info().project.use.baseURL}/src/tests/browser/fixtures/export-preview.html`);
    const canvas = page.getByLabel("本次实际生成的 PDF 页面"), text = page.getByLabel("第 1 页文字");
    await expect(text).toContainText("SOURCE_A_PAGE_1");
    for (const mode of ["fit-width", "actual-size", "200"]) {
      await page.getByRole("combobox", { name: "预览缩放" }).selectOption(mode);
      await expect(page.getByRole("region", { name: "实际 PDF 预览" })).toHaveAttribute("aria-busy", "false");
      await expect(canvas).toBeVisible();
      await expect(text).toContainText("SOURCE_A_PAGE_1");
      const geometry = await canvas.evaluate(element => { const c = element as HTMLCanvasElement; return { width: c.width, height: c.height, cssWidth: parseFloat(c.style.width), cssHeight: parseFloat(c.style.height), textWidth: c.nextElementSibling!.getBoundingClientRect().width }; });
      expect(geometry.width).toBe(Math.floor(geometry.cssWidth * dpr));
      // CSSOM serializes 1066.666…px as 1066.67px; allow its subpixel rounding plus one backing pixel.
      expect(Math.abs(geometry.height - geometry.cssHeight * dpr)).toBeLessThanOrEqual(1 + .01 * dpr);
      expect(geometry.textWidth).toBeCloseTo(geometry.cssWidth, 2);
      if (mode === "actual-size") expect(geometry.cssWidth).toBe(800);
      if (mode === "200") expect(geometry.cssWidth).toBe(1600);
    }
    const selected = await text.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); return selection.toString(); });
    expect(selected).toContain("SOURCE_A_PAGE_1");
    await page.getByRole("button", { name: "下一页" }).click();
    await expect(page.getByLabel("第 2 页文字")).toContainText("SOURCE_A_PAGE_2");
    if (dpr === 2) {
      await page.getByRole("combobox", { name: "预览缩放" }).selectOption("300");
      await expect(page.getByRole("status").filter({ hasText: "分辨率已降低" })).toBeVisible();
      expect(await canvas.evaluate(e => (e as HTMLCanvasElement).width * (e as HTMLCanvasElement).height)).toBeLessThanOrEqual(16 * 1024 * 1024);
    }
    await page.screenshot({ path: info.outputPath(`dpr-${dpr}.png`) });
  } finally { await context.close(); }
});

test("real viewer recovers from malformed bytes and hidden/resized containers", async ({ page }) => {
  await page.goto("/src/tests/browser/fixtures/export-preview.html");
  await expect(page.getByLabel("第 1 页文字")).toContainText("SOURCE_A_PAGE_1");
  await page.getByRole("button", { name: "损坏 PDF" }).click();
  await expect(page.getByRole("alert")).toContainText("读取失败");
  await page.getByRole("button", { name: "来源 B" }).click();
  await expect(page.getByLabel("第 1 页文字")).toContainText("SOURCE_B_PAGE_1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "切换预览区域" }).click();
  await expect(page.getByLabel("本次实际生成的 PDF 页面")).not.toBeVisible();
  await page.setViewportSize({ width: 640, height: 720 });
  await page.getByRole("button", { name: "切换预览区域" }).click();
  await expect(page.getByRole("region", { name: "实际 PDF 预览" })).toHaveAttribute("aria-busy", "false");
  await expect(page.getByLabel("第 1 页文字")).toContainText("SOURCE_B_PAGE_1");
  await expect(page.getByLabel("本次实际生成的 PDF 页面")).toBeVisible();
});

for (const width of [1280, 640]) test(`production dialog keeps preview and actions reachable at width ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/src/tests/browser/fixtures/export-preview.html");
  await page.getByRole("button", { name: "打开导出对话框" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await expect(dialog.getByText("文档结构预览；尚未生成可核验 PDF，保存由系统打印管理。")).toBeVisible();
  await expect(dialog.getByTitle("导出文档结构预览")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "系统打印" })).toBeEnabled();
  const bounds = await dialog.getByRole("button", { name: "系统打印" }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  const optionsBounds = await dialog.locator(".document-export-options").boundingBox();
  const previewBounds = await dialog.locator(".document-export-preview").boundingBox();
  if (width === 1280) expect(previewBounds!.x).toBeGreaterThanOrEqual(optionsBounds!.x + optionsBounds!.width);
  else expect(previewBounds!.y).toBeGreaterThanOrEqual(optionsBounds!.y + optionsBounds!.height);
  await page.screenshot({ path: info.outputPath(`dialog-${width}.png`) });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
