import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
for (const width of [320, 360, 720]) for (const theme of ["light", "dark"]) {
  test(`unified content ${width}px ${theme}: import, pin, multiple reads, safe table, source`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/src/tests/browser/fixtures/unified-content.html?theme=${theme}`);
    await page.getByLabel("导入 Markdown").setInputFiles(resolve("../../../../development/test-data/unified-content/mixed-content.md"));
    await expect(page.getByRole("status")).toHaveText("已导入并固定上下文，保留 2 次读取");
    await page.getByRole("button", { name: /1 篇来源.*2 处引用/ }).click();
    await page.getByRole("button", { name: "查看全部证据" }).click();
    const inspector = page.getByRole("region", { name: "证据详情" });
    await expect(inspector.locator('th[colspan="2"]').first()).toHaveText("编辑指标");
    await expect(inspector.locator("caption")).toHaveText("合成数据：只用于显示测试");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`content-${width}-${theme}.png`), fullPage: true });
    await inspector.getByRole("button", { name: "打开原文" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "同版本原文，第" })).toBeVisible();
    await expect(page.getByRole("region", { name: "同版本原文" }).locator('th[colspan="2"]')).toHaveText("编辑指标");
    const selected = await page.getByRole("textbox", { name: "被引用原文选区" }).evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd));
    expect(selected).toContain('span="2"');
    if (width === 720) {
      await page.evaluate(() => document.body.style.zoom = "2");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`content-200pct-${theme}.png`), fullPage: true });
    }
  });
}
