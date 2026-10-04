import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
});

test("triple-click opens Markdown in immersion, edges reveal panels, F11 toggles fullscreen and Escape restores the workspace", async ({ page }, testInfo) => {
  await page.goto("/");
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  await library.getByLabel("选择文献库文件").setInputFiles({ name: "focus.md", mimeType: "text/markdown", buffer: Buffer.from("# Focus Reading\n\n" + "A quiet space for scientific reading.\n\n".repeat(100)) });
  const file = library.getByRole("button", { name: "选择文件 Focus Reading", exact: true });
  await expect(file).toBeVisible();
  const composer = page.locator("textarea.assistant-input");
  await composer.fill("Keep this unsent draft");
  const before = await page.locator('[data-region="main"]').boundingBox();
  const preferences = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => /pane/.test(key))));
  await file.click({ clickCount: 3 });
  const frame = page.locator(".workspace-frame");
  await expect(frame).toHaveAttribute("data-reading-focus", "reading");
  const reading = page.getByRole("region", { name: "文件阅读器", exact: true });
  await expect(reading.getByRole("heading", { name: "Focus Reading", exact: true })).toBeVisible();
  const main = page.locator('[data-region="main"]');
  expect((await main.boundingBox())!.width).toBeGreaterThan(1590);
  expect((await main.boundingBox())!.height).toBeGreaterThan(850);
  await expect(page.getByRole("toolbar", { name: "工作区命令栏" })).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(reading.getByRole("button", { name: "返回文献库", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "左边栏导航" })).toBeHidden();
  const scroll = reading.locator(".reading-document__scroll");
  await scroll.evaluate((element) => { element.scrollTop = 600; });
  await page.mouse.move(1599, 400);
  await expect(composer).toBeHidden();
  await page.keyboard.press("F11");
  await expect(frame).toHaveAttribute("data-reading-focus", "fullscreen");
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  // The reclaimed taskbar strip must belong to the reading viewport, including
  // after the native window reports a larger monitor client area.
  for (const height of [1000, 1080]) {
    await page.setViewportSize({ width: 1600, height });
    await expect.poll(async () => {
      const bounds = await scroll.boundingBox();
      return bounds ? Math.abs(bounds.y) + Math.abs(bounds.y + bounds.height - height) : Infinity;
    }).toBeLessThan(2);
    expect(await page.evaluate((y) => document.elementsFromPoint(800, y).some(element => element.closest(".reading-document__scroll")), height - 12)).toBe(true);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.mouse.move(800, 400);
  await page.mouse.move(1599, 400);
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Keep this unsent draft");
  // Revealing side panels overlays the reader instead of resizing it.
  expect((await main.boundingBox())!.width).toBeGreaterThan(1590);
  await page.mouse.move(800, 400);
  await expect(composer).toBeHidden();
  await page.mouse.move(1, 400);
  await expect(library).toBeVisible();
  await page.mouse.move(800, 999);
  await expect(page.getByLabel("文件状态栏", { exact: true })).toBeVisible();
  await page.mouse.move(800, 1);
  await expect(page.getByRole("toolbar", { name: "沉浸阅读控制" })).toBeVisible();
  await page.mouse.move(800, 400);
  await expect(page.getByRole("toolbar", { name: "沉浸阅读控制" })).toBeHidden();
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  await page.screenshot({ path: testInfo.outputPath("immersive-markdown.png") });
  await page.keyboard.press("F11");
  await expect(frame).toHaveAttribute("data-reading-focus", "off");
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(composer).toBeVisible(); await expect(composer).toHaveValue("Keep this unsent draft");
  expect((await main.boundingBox())!.width).toBeCloseTo(before!.width, 0);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => /pane/.test(key))))).toBe(preferences);
  await file.click({ clickCount: 3 });
  await page.keyboard.press("Escape");
  await expect(frame).toHaveAttribute("data-reading-focus", "off");
  await expect(library).toBeVisible();
});

test("a PDF tab enters immersion without remounting the document and restores its controls", async ({ page }, testInfo) => {
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture#importable");
  const canvas = page.locator(".pdf-page-canvas").first();
  await expect(canvas).toBeVisible();
  const frame = page.locator(".workspace-frame");
  const handle = await canvas.elementHandle();
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click({ clickCount: 3 });
  await expect(frame).toHaveAttribute("data-reading-focus", "reading");
  await expect(page.locator(".pdf-reader-top")).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.keyboard.press("F11");
  await expect(frame).toHaveAttribute("data-reading-focus", "fullscreen");
  await page.mouse.move(800, 400);
  await expect(page.locator(".pdf-reader-top")).toBeHidden();
  await expect(page.locator(".pdf-left-sidebar")).toBeHidden();
  const stage = page.locator(".pdf-stage");
  expect((await stage.boundingBox())!.width).toBeGreaterThan(1550);
  expect((await stage.boundingBox())!.height).toBeGreaterThan(950);
  await expect.poll(async () => {
    const bounds = await stage.boundingBox();
    return bounds ? Math.abs(bounds.y) + Math.abs(bounds.y + bounds.height - 1000) : Infinity;
  }).toBeLessThan(2);
  expect(await handle!.evaluate((element) => element.isConnected)).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: testInfo.outputPath("immersive-pdf-dark.png") });
  const bounds = await stage.boundingBox();
  await stage.evaluate((element) => { element.scrollTop = 100; });
  const offset = await stage.evaluate((element) => element.scrollTop);
  for (const [x, y] of [[800, 1], [1, 400], [1599, 400], [800, 999], [800, 1]]) {
    await page.mouse.move(x, y);
    await expect.poll(() => stage.boundingBox()).toEqual(bounds);
    expect(await stage.evaluate((element) => element.scrollTop)).toBe(offset);
  }
  await expect(page.locator(".pdf-reader-top")).toBeVisible();
  await page.getByRole("button", { name: "退出沉浸阅读", exact: true }).click();
  await expect(frame).toHaveAttribute("data-reading-focus", "off");
  await expect(page.locator(".pdf-reader-top")).toBeVisible();
  expect(await handle!.evaluate((element) => element.isConnected)).toBe(true);
});
