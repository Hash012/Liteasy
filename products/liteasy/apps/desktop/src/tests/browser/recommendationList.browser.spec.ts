import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`compact recommendations show details below in ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 480, height: 640 });
  await page.goto(`/src/tests/browser/fixtures/recommendation-list.html?${theme}`);
  const list = page.getByRole("list", { name: "推荐论文" });
  const row = list.getByRole("button", { name: /^查看推荐/ }).first();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(38);
  expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(list).not.toContainText("来自选中文献");
  await expect(list).toContainText("2024-06");
  await row.click();
  await expect(page.getByLabel("文件状态栏", { exact: true })).toContainText("Researcher A");
  await expect(page.getByText(/^下载请求/)).toHaveCount(0);
  await row.dblclick();
  await expect(page.getByText(/^下载请求/)).toBeVisible();
  await page.getByRole("button", { name: "展开推荐元信息" }).click();
  await expect(page.getByRole("region", { name: "推荐文献元信息" })).toContainText("A detailed abstract");
  await page.screenshot({ path: testInfo.outputPath(`recommendations-${theme}.png`), animations: "disabled" });
});
