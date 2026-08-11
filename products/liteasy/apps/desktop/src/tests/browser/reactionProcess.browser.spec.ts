import { expect, test } from "@playwright/test";

async function expectReactionProcessRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("reaction-process-browser-fixture");
  await expect(stage).toBeVisible();
  const processStage = stage.getByTestId("reaction-process-stage");
  const svg = processStage.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-overall")).toBeVisible();
  await expect(svg.locator("#object-ch4")).toContainText("CH4");
  await expect(svg.locator("#object-ch4")).toContainText("(g)");
  const initialScene = await processStage.screenshot();
  await stage.getByRole("button", { name: "下一步" }).click();
  await expect(stage.getByTestId("reaction-process-step")).toHaveText("1 / 2");
  await expect(processStage).toHaveAttribute("data-scene-phase", "transition");
  const transitionScene = await processStage.screenshot();
  expect(transitionScene.equals(initialScene)).toBe(false);
  await stage.getByRole("slider", { name: "反应步骤" }).fill("2");
  await expect(processStage).toHaveAttribute("data-scene-phase", "products");
  const productScene = await processStage.screenshot();
  expect(productScene.equals(transitionScene)).toBe(false);
  await stage.getByRole("button", { name: "播放" }).click();
  await expect(stage.getByRole("button", { name: "暂停" })).toBeVisible();
  await stage.getByRole("button", { name: "暂停" }).click();
  const beforeSelection = await processStage.screenshot();
  await stage.getByRole("button", { name: "co2" }).click();
  await expect(stage.getByRole("button", { name: "co2" })).toHaveAttribute("aria-pressed", "true");
  const afterSelection = await processStage.screenshot();
  expect(afterSelection.equals(beforeSelection)).toBe(false);
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  expect(await svg.evaluate((element) => element.outerHTML.includes("molecule-3d"))).toBe(false);
  await expect(page.getByTestId("reaction-process-scene-metadata")).toHaveText("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)|ch4,o2,co2,h2o,overall");
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
