import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
async function open(page: Page) {
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.goto("/src/tests/browser/fixtures/quick-ask.html");
  const text = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer span').filter({ hasText: /./ }).first();
  await expect(text).toBeVisible({ timeout: 30000 });
  const bounds = await text.boundingBox();
  if (!bounds) throw new Error("Synthetic PDF did not render");
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 10 }); await page.mouse.up();
  await page.getByRole("button", { name: "速问", exact: true }).click();
}
test("real reader streams once, preserves a hidden run and persists private answer through reload", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  await expect(page.getByRole("button", { name: "解释选段", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  expect(await page.evaluate(() => (window as any).quickAskFixture.requests.length)).toBe(0);
  await page.getByRole("button", { name: "讲清楚", exact: true }).click();
  await page.screenshot({ path: info.outputPath("quick-ask-ready.png") });
  await page.getByRole("button", { name: "解释选段", exact: true }).click();
  await expect(page.getByText("正在回答…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await expect(page.getByRole("button", { name: /返回速问/ })).toBeVisible();
  const resume = await page.getByRole("button", { name: /返回速问/ }).boundingBox();
  const toolbar = await page.getByRole("toolbar", { name: "PDF 导航工具栏" }).boundingBox();
  expect(resume!.y + resume!.height).toBeLessThanOrEqual(toolbar!.y);
  await page.getByRole("button", { name: /返回速问/ }).click();
  await expect(page.getByText("已保存为私人批注", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).quickAskFixture.requests.length)).toBe(1);
  const wire = await page.evaluate(() => (window as any).quickAskFixture.requests[0]);
  expect(wire.tools).toBeUndefined(); expect(wire.prompt).not.toContain("liteasy_asset_action");
  await expect(page.locator(".quick-ask-surface .katex")).toBeVisible();
  await expect(page.locator(".quick-ask-surface table")).toBeVisible();
  await page.screenshot({ path: info.outputPath("quick-ask-result.png") });
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel(/速问：第 1 页/).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).quickAskFixture.requests.length)).toBe(0);
});
for (const width of [320, 448, 768, 1440]) for (const theme of ["light", "dark", "forced"]) {
  test(`quick ask ${width}px ${theme} keeps primary action and keyboard accessible`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
    if (theme === "dark") { await page.getByRole("button", { name: "收起", exact: true }).click(); await page.getByRole("button", { name: "深色主题" }).click(); await page.getByRole("button", { name: /返回速问/ }).click(); }
    if (theme === "forced") await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width, height: 800 });
    const primary = page.getByRole("button", { name: "解释选段", exact: true });
    await expect(primary).toBeVisible();
    await expect(async () => { const box = await primary.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); }).toPass();
    const surface = page.locator(".product-overlay-sheet,.product-overlay-popover").filter({ visible: true });
    await expect(surface).toBeVisible();
    await expect(async () => { const panel = await surface.boundingBox(); expect(panel!.width).toBeLessThanOrEqual(width); }).toPass();
    if (width < 560) await expect(page.getByRole("dialog")).toBeVisible();
    const composer = page.getByRole("textbox", { name: "速问问题" });
    await composer.fill("中文指令\n第二行"); await composer.press("Enter");
    expect(await page.evaluate(() => (window as any).quickAskFixture.requests.length)).toBe(0);
    await composer.press("Control+Enter");
    await expect(page.getByText("已保存为私人批注", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).quickAskFixture.requests.length)).toBe(1);
    await page.screenshot({ path: info.outputPath(`quick-ask-${width}-${theme}.png`) });
  });
}

test("reader preset management stays usable in a narrow overlay without generating", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole("button", { name: "管理快捷指令", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "管理快捷指令", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "快捷指令名称", exact: true }).fill("合成指令");
  await dialog.getByRole("textbox", { name: "完整快捷指令", exact: true }).fill("保留术语，解释选段。");
  await dialog.getByRole("button", { name: "保存快捷指令", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "解释选段", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "管理快捷指令", exact: true }).click();
  const select = dialog.getByRole("combobox", { name: "管理快捷指令", exact: true });
  await select.click();
  const option = page.getByRole("option", { name: /^合成指令/ });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(dialog.getByRole("textbox", { name: "完整快捷指令", exact: true })).toHaveValue("保留术语，解释选段。");
  expect(await page.evaluate(() => (window as any).quickAskFixture.requests.length)).toBe(0);
  await page.screenshot({ path: info.outputPath("quick-ask-reader-presets.png") });
});
