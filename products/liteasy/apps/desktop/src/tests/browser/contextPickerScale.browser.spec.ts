import { expect, test } from "@playwright/test";
for (const [width, height] of [[1280, 800], [1366, 768], [1920, 1080], [680, 800]]) {
  test(`GROUP/UI: ${width}×${height} keeps 760 images and 594 pages aggregated`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/src/tests/browser/fixtures/context-picker-scale.html");
    await page.getByRole("button", { name: "添加上下文", exact: true }).click();
    await page.getByRole("button", { name: "全部资产", exact: true }).click();
    await expect(page.locator('.context-picker-row')).toHaveCount(23);
    await expect(page.locator('.context-asset-card')).toHaveCount(1);
    await page.getByRole("navigation", { name: "上下文资产筛选" }).getByRole("button", { name: /^图片/ }).click();
    await expect(page.locator('.context-picker-row')).toHaveCount(22);
    const dialog = page.getByRole("dialog");
    const overflowing = await dialog.evaluate(root => root.scrollWidth > root.clientWidth + 1);
    expect(overflowing).toBe(false);
    await expect(page.getByRole("button", { name: "添加所选（0）" })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`01-aggregated-${width}.png`), animations: "disabled" });
    const first = page.locator('[data-picker-id="paper:paper-0"]');
    await first.getByRole("checkbox").check();
    await expect(page.getByText("待加入 37 项", { exact: true })).toBeVisible();
    await first.getByRole("button", { name: /^进入/ }).click();
    await expect(page.locator('.context-asset-card')).toHaveCount(37);
    await expect(page.getByRole("button", { name: "预览 图片 1 · 第 1 页", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "推荐", exact: true }).click();
    await expect(page.locator('.context-picker-row')).toHaveCount(1);
    await expect(page.getByText("当前阅读相关", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`03-recommendations-${width}.png`), animations: "disabled" });
  });
}

test("UI: English locale and dark theme retain the compact picker layout", async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/src/tests/browser/fixtures/context-picker-scale.html");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.evaluate(async () => {
    const modulePath = "/src/app/shared/i18n/i18n.ts";
    const { changeUiLocale } = await import(/* @vite-ignore */ modulePath);
    await changeUiLocale("en-US");
  });
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await page.getByRole("button", { name: "全部资产", exact: true }).click();
  await expect(page.locator(".context-picker-row")).toHaveCount(23);
  expect(await page.getByRole("dialog").evaluate(root => root.scrollWidth > root.clientWidth + 1)).toBe(false);
  await expect(page.getByRole("button", { name: "添加所选（0）" })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("04-picker-dark-english.png"), animations: "disabled" });
});
