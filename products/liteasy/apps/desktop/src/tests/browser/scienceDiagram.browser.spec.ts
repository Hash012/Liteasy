import { expect, test } from "@playwright/test";

async function expectScienceDiagramFixture(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("science-diagram-browser-fixture");
  await expect(stage).toBeVisible();
  await expect(stage.getByTestId("science-circuit").locator("svg")).toBeVisible();
  await expect(stage.getByTestId("science-physics").locator("svg")).toBeVisible();
  await expect(stage.getByTestId("science-circuit").locator("path")).toHaveCount(2);
  await expect(stage.getByTestId("science-physics").locator("path")).toHaveCount(1);
  expect(await stage.locator("svg").first().evaluate((svg) => svg.outerHTML.includes("<script"))).toBe(false);
  await expect(stage.getByTestId("science-diagram-metadata")).toHaveText("battery,resistor,wire-1,wire-2|projectile,gravity");
}

test("renders circuit and physics diagrams on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?science-diagram-fixture");
  await expectScienceDiagramFixture(page);
});

test("keeps circuit and physics diagrams readable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?science-diagram-fixture");
  await expectScienceDiagramFixture(page);
});
