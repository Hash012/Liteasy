import { expect, test } from "@playwright/test";

async function expectPhysicsProcessRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("physics-process-browser-fixture");
  await expect(stage).toBeVisible();
  const svg = stage.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-trajectory")).toBeVisible();
  await stage.getByRole("button", { name: "下一帧" }).click();
  await expect(stage.getByTestId("physics-process-frame")).toHaveText("1 / 60");
  await stage.getByRole("button", { name: "trajectory" }).click();
  await expect(stage.getByRole("button", { name: "trajectory" })).toHaveAttribute("aria-pressed", "true");
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  await expect(page.getByTestId("physics-process-scene-metadata")).toHaveText("61|trajectory");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders physics process timeline on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?physics-process-fixture");
  await expectPhysicsProcessRendered(page);
});

test("keeps physics process controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?physics-process-fixture");
  await expectPhysicsProcessRendered(page);
});
