import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function openPdf(page: Page) {
  const pdf = await readFile(resolve("../../../../development/test-data/pdf-selection/glyph-boundaries.pdf"));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture");
  await expect(page.locator(".pdf-text-layer").first()).toContainText("WiWi tail");
}

async function expectNativeResolution(page: Page) {
  const canvas = page.locator(".pdf-page-canvas").first();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(Math.abs(element.width - bounds.width * devicePixelRatio),
      Math.abs(element.height - bounds.height * devicePixelRatio));
  })).toBeLessThan(0.05);
  // A resized but blank canvas is not a successful high-density render.
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] && pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) ink++;
    }
    return ink;
  })).toBeGreaterThan(50);
}

for (const density of [1, 1.25, 1.5, 2]) {
  test.describe(`PDF raster at ${density}x screen density`, () => {
    test.use({ deviceScaleFactor: density, viewport: { width: 1537, height: 1001 } });
    test("keeps native resolution through fractional zooms and rapid zoom changes", async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("console", (message) => { if (message.type() === "error" && /渲染失败|same canvas/.test(message.text())) errors.push(message.text()); });
      await openPdf(page);
      await expectNativeResolution(page);
      let zoom = 100;
      for (const target of [85, 125, 180, 100]) {
        const step = target > zoom ? 5 : -5;
        while (zoom !== target) {
          await page.getByRole("button", { name: step > 0 ? "按比例放大 PDF" : "按比例缩小 PDF", exact: true }).click();
          zoom += step;
        }
        await expect(page.getByLabel(`PDF 显示比例 ${target}%`)).toBeVisible();
        await expectNativeResolution(page);
        if (target === 180) {
          const stage = page.getByLabel("PDF 页面滚动区");
          const bounds = (await stage.boundingBox())!;
          const canvas = page.locator(".pdf-page-canvas").first();
          await stage.evaluate((element) => { element.scrollLeft = 0; });
          expect((await canvas.boundingBox())!.x).toBeGreaterThanOrEqual(bounds.x);
          await stage.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
          const end = (await canvas.boundingBox())!;
          expect(end.x + end.width).toBeLessThanOrEqual(bounds.x + bounds.width);
          await stage.evaluate((element) => { element.scrollLeft = 0; });
        }
      }
      await page.screenshot({ path: testInfo.outputPath("native-resolution.png") });
      expect(errors).toEqual([]);
    });
  });
}

test("repaints after moving to a different-density screen without resizing the reader", async ({ page, context }) => {
  await page.setViewportSize({ width: 1537, height: 1001 });
  await openPdf(page);
  const canvas = page.locator(".pdf-page-canvas").first();
  const before = await canvas.evaluate((element: HTMLCanvasElement) => ({ pixels: element.width, width: element.getBoundingClientRect().width }));
  const session = await context.newCDPSession(page);
  for (const deviceScaleFactor of [2, 1.25, 1]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width: 1537, height: 1001, deviceScaleFactor, mobile: false });
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(deviceScaleFactor);
    // CDP updates DPR but omits the native window/resolution change notification.
    // Keep CSS dimensions fixed while notifying the same resize listener as a monitor move.
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expectNativeResolution(page);
    const after = await canvas.evaluate((element: HTMLCanvasElement) => ({ pixels: element.width, width: element.getBoundingClientRect().width }));
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    if (deviceScaleFactor > 1) expect(after.pixels).toBeGreaterThan(before.pixels);
  }
  await session.detach();
});
