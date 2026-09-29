import { expect, test } from "@playwright/test";
for (const theme of ["light", "dark"]) test(`organization and paper-linked artifacts stay readable in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`/src/tests/browser/fixtures/management-pages.html?${theme}`);
  await expect(page.getByRole("heading", { name: "认知与机器学习研究组" })).toBeVisible();
  await page.getByRole("button", { name: "当前论文" }).click();
  await expect(page.getByRole("combobox", { name: "按来源论文筛选" })).toHaveValue("larimar");
  await page.getByRole("combobox", { name: "按产物类型筛选" }).selectOption("ppt");
  await expect(page.getByRole("status")).toContainText("4 项");
  await page.getByRole("button", { name: "全部标记已读" }).click();
  await expect(page.getByRole("button", { name: "全部标记已读" })).toBeDisabled();
  await page.getByRole("button", { name: "清除筛选" }).click();
  expect(await page.locator(".artifact-library-results").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const row = page.locator(".artifact-library-saved-row").first();
  const rowBounds = (await row.boundingBox())!;
  const titleBounds = (await row.locator(".artifact-library-title").boundingBox())!;
  expect(titleBounds.x - rowBounds.x).toBeLessThan(64);
  for (const width of [1000, 620]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`management-${theme}-${width}.png`) });
  }
  await page.getByRole("button", { name: "打开组织窗口" }).click();
  const dialog = page.getByRole("dialog", { name: "组织窗口" });
  await expect(dialog).toBeVisible();
  await page.getByRole("textbox", { name: "搜索组织" }).fill("数据库");
  await expect(dialog.getByRole("button", { name: "打开 数据库系统小组 详情" })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ animations: "disabled", path: info.outputPath(`organization-dialog-${theme}.png`) });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
