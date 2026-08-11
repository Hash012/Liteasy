import { expect, test } from "@playwright/test";

async function expectGeometry2DRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("geometry-2d-browser-fixture");
  await expect(stage).toBeVisible();
  const svg = stage.getByRole("img", { name: "circle, line, tangent-point" });
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-circle")).toBeVisible();
  await expect(svg.locator("#object-line")).toBeVisible();
  await expect(svg.locator("#object-tangent-point")).toBeVisible();
  const initialScene = await stage.getByTestId("geometry-2d-stage").screenshot();
  await stage.getByRole("button", { name: "放大二维几何" }).click();
  const zoomedScene = await stage.getByTestId("geometry-2d-stage").screenshot();
  expect(zoomedScene.equals(initialScene)).toBe(false);
  const geometryStage = stage.getByTestId("geometry-2d-stage");
  const viewportBeforeDrag = await geometryStage.getAttribute("data-viewport");
  const bounds = await geometryStage.boundingBox();
  if (!bounds) throw new Error("geometry_2d_stage_bounds_missing");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.6);
  await page.mouse.up();
  await expect(geometryStage).not.toHaveAttribute("data-viewport", viewportBeforeDrag ?? "");
  const beforeSelection = await geometryStage.screenshot();
  await stage.getByRole("button", { name: "circle" }).click();
  await expect(stage.getByRole("button", { name: "circle" })).toHaveAttribute("aria-pressed", "true");
  const afterSelection = await geometryStage.screenshot();
  expect(afterSelection.equals(beforeSelection)).toBe(false);
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
