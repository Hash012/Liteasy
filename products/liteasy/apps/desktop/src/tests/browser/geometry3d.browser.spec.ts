import { expect, test } from "@playwright/test";

async function expectGeometry3DRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("geometry-3d-browser-fixture");
  await expect(stage).toBeVisible();
  const svg = stage.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-cube")).toBeVisible();
  await expect(svg.locator("#object-mid-section")).toBeVisible();
  await stage.getByRole("button", { name: "cube" }).click();
  await expect(stage.getByRole("button", { name: "cube" })).toHaveAttribute("aria-pressed", "true");
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  await expect(page.getByTestId("geometry-3d-scene-metadata")).toHaveText("6|cube,mid-section");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders 3d geometry fallback projection on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?geometry-3d-fixture");
  await expectGeometry3DRendered(page);
});

test("keeps 3d geometry fallback usable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?geometry-3d-fixture");
  await expectGeometry3DRendered(page);
});
