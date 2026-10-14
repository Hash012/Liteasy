import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
const fixtures = ["valid-wide.png", "valid-tall.png", "valid.jpg", "valid.svg"];
const images = fixtures.map((name) => `data:image/${name.endsWith(".svg") ? "svg+xml" : name.endsWith(".jpg") ? "jpeg" : "png"};base64,${readFileSync(new URL(`../../../../../../../development/test-data/context-preview/${name}`, import.meta.url)).toString("base64")}`);
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1980, height: 1350 });
  await page.addInitScript((urls) => { Object.assign(window, { catalogImageUrls: urls }); }, images);
  await page.goto("/src/tests/browser/fixtures/context-catalog.html");
  await expect(page.getByRole("dialog", { name: "上下文资产浏览器" })).toBeVisible();
});
test("S2 default list keeps details lazy and selects only filtered paper results", async ({ page }, info) => {
  await expect(page.getByRole("complementary", { name: "资产预览" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "列表", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "搜索全部上下文资产" }).fill("kind:paper");
  await page.getByRole("checkbox", { name: "全选筛选结果", exact: true }).check();
  await expect(page.getByText("已选 3 项", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加所选（3）", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "添加所选（3）", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已添加 3 项上下文。");
  await expect(page.getByText("已选 0 项", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("S2-context-papers.png"), fullPage: true, animations: "disabled" });
});
test("S3 gallery decodes real images and preserves aspect ratios", async ({ page }, info) => {
  await page.getByRole("textbox", { name: "搜索全部上下文资产" }).fill("kind:image");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  const images = page.locator(".context-asset-thumbnail img");
  await expect(images).toHaveCount(12);
  await expect.poll(() => images.evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(images.first()).toHaveCSS("object-fit", "contain");
  await page.screenshot({ path: info.outputPath("S3-context-images.png"), fullPage: true, animations: "disabled" });
});
test("S4 details render real markdown without a stuck read and close on narrow screens", async ({ page }, info) => {
  await page.getByRole("button", { name: "预览 实验设置与结果分析", exact: true }).first().click();
  const detail = page.getByRole("complementary", { name: "资产预览" });
  await expect(detail.getByRole("heading", { name: "实验设置", exact: true })).toBeVisible();
  await expect(detail.getByRole("table")).toBeVisible();
  await expect(detail.getByText("正在读取预览…", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("S4-context-details.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(detail).toBeVisible();
  await expect(page.getByRole("region", { name: "可添加资产" })).not.toBeVisible();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(page.getByRole("region", { name: "可添加资产" })).toBeVisible();
});

test("records a 10k metadata query sample without rendering the full catalog", async ({ page }, info) => {
  await page.evaluate(() => (window as unknown as { loadLargeCatalog(): void }).loadLargeCatalog());
  await expect(page.locator(".context-asset-card")).toHaveCount(60);
  const result = await page.evaluate(() => (window as unknown as { measureCatalogQuery(): { items: number; renderedRows: number; bodyReads: number } }).measureCatalogQuery());
  expect(result.items).toBe(10000); expect(result.renderedRows).toBe(60); expect(result.bodyReads).toBe(0);
  const path = info.outputPath("catalog-query-performance.json");
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  await info.attach("catalog-query-performance.json", { path, contentType: "application/json" });
});

test("advanced facets show counts with their own format constraint excluded", async ({ page }) => {
  await page.getByRole("textbox", { name: "搜索全部上下文资产" }).fill("kind:image tag:图表 format:png");
  await page.getByRole("button", { name: "高级检索条件", exact: true }).click();
  await page.getByRole("combobox", { name: "包含格式", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: /JPG/ })).toContainText("3");
  await expect(page.getByRole("menuitemcheckbox", { name: /PNG/ })).toContainText("6");
});
