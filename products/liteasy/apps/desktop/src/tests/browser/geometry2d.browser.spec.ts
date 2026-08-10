import { expect, test } from "@playwright/test";

async function expectGeometry2DRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("geometry-2d-browser-fixture");
  await expect(stage).toBeVisible();
  const svg = stage.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-circle")).toBeVisible();
  await expect(svg.locator("#object-line")).toBeVisible();
  await expect(svg.locator("#object-tangent-point")).toBeVisible();
  await stage.getByRole("button", { name: "circle" }).click();
  await expect(stage.getByRole("button", { name: "circle" })).toHaveAttribute("aria-pressed", "true");
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  await expect(page.getByTestId("geometry-2d-scene-metadata")).toHaveText("0,1|circle,line,tangent-point");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders plane geometry deterministically on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?geometry-2d-fixture");
  await expectGeometry2DRendered(page);
});

test("keeps plane geometry usable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?geometry-2d-fixture");
  await expectGeometry2DRendered(page);
});
