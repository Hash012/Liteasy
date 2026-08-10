import { expect, test } from "@playwright/test";

async function expectReactionProcessRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("reaction-process-browser-fixture");
  await expect(stage).toBeVisible();
  const svg = stage.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-overall")).toBeVisible();
  await stage.getByRole("button", { name: "下一步" }).click();
  await expect(stage.getByTestId("reaction-process-step")).toHaveText("1 / 1");
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  await expect(page.getByTestId("reaction-process-scene-metadata")).toHaveText("CH4 + 2O2 -> CO2 + 2H2O|ch4,o2,co2,h2o,overall");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders reaction process on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?reaction-process-fixture");
  await expectReactionProcessRendered(page);
});

test("keeps reaction process readable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?reaction-process-fixture");
  await expectReactionProcessRendered(page);
});
