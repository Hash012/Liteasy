import { expect, test } from "@playwright/test";

for (const viewport of [
  { height: 920, name: "desktop", width: 1440 },
  { height: 844, name: "narrow", width: 390 }
]) {
  test(`artifact library remains usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?artifact-library-fixture");

    await expect(page.getByRole("tab", { name: "已保存" })).toBeVisible();
    await page.getByRole("tab", { name: "已导出" }).click();
    await expect(page.getByText("文件不可用")).toBeVisible();
    await expect(page.getByText("由浏览器管理")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    await page.screenshot({
      fullPage: true,
      path: `test-results/artifact-library-${viewport.name}.png`
    });
  });
}
