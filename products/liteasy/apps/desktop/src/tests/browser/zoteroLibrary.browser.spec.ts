import { expect, test } from "@playwright/test";

for (const size of [14, 24]) test(`library and metadata use the same type scale at ${size}px`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto(`/src/tests/browser/fixtures/zotero-library.html?font=${size}`);
  const catalog = page.getByRole("region", { name: "阅读库", exact: true });
  await expect(catalog.getByRole("heading", { name: "阅读库", exact: true })).toBeVisible();
  const font = (selector: string) => page.locator(selector).first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(await font(".reading-catalog-table")).toBeCloseTo(size, 1);
  expect(await font(".reading-catalog-heading h2")).toBeCloseTo(16 * size / 14, 1);
  expect(await font(".bibliographic-editor h2")).toBeCloseTo(16 * size / 14, 1);
  expect(await font(".resource-tag-chip")).toBeCloseTo(12 * size / 14, 1);
  expect(await font(".reading-catalog-authors")).toBeCloseTo(12 * size / 14, 1);
  expect(await font(".bibliographic-editor > header span")).toBeCloseTo(12 * size / 14, 1);
  await page.screenshot({ path: info.outputPath("library-type-scale.png"), fullPage: true });
});

for (const size of [14, 24]) test(`catalog toolbar controls share density at ${size}px`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto(`/src/tests/browser/fixtures/zotero-library.html?font=${size}`);
  const toolbar = page.getByRole("search", { name: "筛查阅读库" });
  const input = toolbar.locator(".reading-catalog-search");
  const filter = toolbar.getByRole("button", { name: "文件筛选", exact: true });
  const picker = toolbar.locator(".product-option-picker");
  await expect(input).toBeVisible();
  const heights = await Promise.all([input, filter, picker].map(async control => (await control.boundingBox())!.height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(28);
  await picker.click();
  await expect(page.getByRole("option", { name: "标题 A–Z", exact: true })).toBeVisible();
});

test("keyboard selection remains visible across long catalog pages", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/src/tests/browser/fixtures/zotero-library.html");
  const rows = page.getByRole("table", { name: "文献与文件列表" }).locator("tbody tr");
  await rows.nth(49).focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.first()).toBeFocused();
  await expect(rows.first()).toContainText("文献 051");
  await expect(rows.first()).toBeInViewport();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await expect(rows.last()).toContainText("文献 123");
  await expect(rows.last()).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(rows.first()).toContainText("文献 001");
  await expect(rows.first()).toBeFocused();
  await expect(rows.first()).toBeInViewport();
  await expect(rows).toHaveCount(50);
});
