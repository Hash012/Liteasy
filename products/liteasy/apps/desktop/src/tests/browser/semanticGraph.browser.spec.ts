import { expect, test } from "@playwright/test";

async function expectSemanticGraphRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("semantic-graph-browser-fixture");
  await expect(stage).toBeVisible();
  await expect(stage.locator("svg")).toBeVisible();
  await expect(stage.locator("path")).toHaveCount(1);
  await expect(stage.getByRole("button", { name: "输入" })).toBeVisible();
  await stage.getByRole("button", { name: "输入" }).click();
  await expect(stage.getByRole("button", { name: "输入" })).toHaveAttribute("aria-pressed", "true");
  expect(await stage.locator("svg").evaluate((svg) => svg.outerHTML.includes("<script"))).toBe(false);
  expect(await page.getByTestId("semantic-graph-scene-metadata").textContent()).toBe("start,end|start,end");
}

test("renders semantic graph SVG deterministically on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?semantic-graph-fixture");
  await expectSemanticGraphRendered(page);
});

test("renders semantic graph SVG deterministically on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?semantic-graph-fixture");
  await expectSemanticGraphRendered(page);
});
