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
