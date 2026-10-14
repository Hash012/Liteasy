import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto("/src/tests/browser/fixtures/context-picker.html");
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  for (const name of ["A", "论文 P", "提取资产", "图片"]) await page.getByRole("button", { name: `进入 ${name}`, exact: true }).click();
});
test("STATE-01: reopen restores route, page, preview, selection, focused row and scroll anchor", async ({ page }, info) => {
  await page.getByRole("button", { name: /^显示更多/ }).click(); await page.getByRole("button", { name: /^显示更多/ }).click();
  await expect(page.locator(".context-asset-card")).toHaveCount(30);
  await page.getByRole("button", { name: "预览 图 125", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择 图 125", exact: true }).check();
  await page.getByRole("button", { name: "预览 图 125", exact: true }).focus();
  const before = await page.getByRole("region", { name: "可添加资产" }).evaluate(element => element.scrollTop);
  await page.getByRole("button", { name: "返回对话", exact: true }).last().click();
  await expect(page.getByLabel("草稿上下文")).toHaveText("0");
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await expect(page.getByRole("button", { name: "预览 图 125", exact: true })).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "选择 图 125", exact: true })).toBeChecked();
  await expect(page.getByRole("complementary", { name: "资产预览" })).toContainText("图 125");
  const after = await page.getByRole("region", { name: "可添加资产" }).evaluate(element => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(24);
  await page.screenshot({ path: info.outputPath("restored-image-picker.png"), fullPage: true });
});
test("A11Y-01: arrows, Space and Enter remain separate; Ctrl+A in search does not select resources", async ({ page }) => {
  await page.getByRole("button", { name: "预览 图 000", exact: true }).focus();
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("button", { name: "预览 图 001", exact: true })).toBeFocused();
  await page.keyboard.press("Space"); await expect(page.getByRole("checkbox", { name: "选择 图 001", exact: true })).toBeChecked();
  await page.keyboard.press("Enter"); await expect(page.getByRole("complementary", { name: "资产预览" })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("complementary", { name: "资产预览" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索当前范围" }).fill("图"); await page.keyboard.press("Control+a");
  await expect(page.getByText("已选 1 项", { exact: true })).toBeVisible();
});
test("BULK-02: filtered versus whole selection and narrower layout remain explicit", async ({ page }, info) => {
  await page.getByRole("textbox", { name: "搜索当前范围" }).fill("tag:keep");
  await page.getByRole("checkbox", { name: "全选筛选结果", exact: true }).check();
  await expect(page.getByText("已选 15 项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "选择本层全部（150 项内容）" }).click();
  await page.getByRole("button", { name: "确认选择全部" }).click();
  await expect(page.getByText("已选 150 项", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await page.screenshot({ path: info.outputPath("filtered-whole-selection.png"), fullPage: true });
});
