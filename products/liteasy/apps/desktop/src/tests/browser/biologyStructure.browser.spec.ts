import { expect, test } from "@playwright/test";

async function expectBiologyFixture(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("biology-structure-browser-fixture");
  await expect(stage).toBeVisible();
  await expect(stage.locator("svg")).toBeVisible();
  await expect(stage.locator("path")).toHaveCount(4);
  await stage.getByRole("button", { name: "connection-1" }).click();
  await expect(stage.getByRole("button", { name: "connection-1" })).toHaveAttribute("aria-pressed", "true");
  expect(await stage.locator("svg").evaluate((svg) => svg.outerHTML.includes("<script"))).toBe(false);
  await expect(stage.getByTestId("biology-structure-metadata")).toHaveText("neuron,soma,axon,synapse,connection-1");
}

test("renders biology structure on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?biology-structure-fixture");
  await expectBiologyFixture(page);
});

test("renders biology structure on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?biology-structure-fixture");
  await expectBiologyFixture(page);
});
