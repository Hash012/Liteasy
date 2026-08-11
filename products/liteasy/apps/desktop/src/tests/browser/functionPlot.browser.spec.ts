import { expect, test } from "@playwright/test";

async function expectFunctionPlotRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("function-plot-browser-fixture");
  await expect(stage).toBeVisible();
  const svg = stage.getByRole("img", { name: "f(x) over x" });
  await expect(svg).toBeVisible();
  await expect(svg.locator("#plot-segment-0")).toBeVisible();
  await expect(svg.locator("#object-vertex")).toBeVisible();
  const initialScene = await stage.getByTestId("function-plot-stage").screenshot();
  await stage.getByRole("button", { name: "放大函数图" }).click();
  const zoomedScene = await stage.getByTestId("function-plot-stage").screenshot();
  expect(zoomedScene.equals(initialScene)).toBe(false);
  const parameterScene = zoomedScene;
  const parameterSlider = stage.getByRole("slider", { name: "参数 a" });
  await parameterSlider.fill("2");
  const updatedParameterScene = await stage.getByTestId("function-plot-stage").screenshot();
  expect(updatedParameterScene.equals(parameterScene)).toBe(false);
  await parameterSlider.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await parameterSlider.inputValue()).not.toBe("2");
  const plotStage = stage.getByTestId("function-plot-stage");
  const viewportBeforeDrag = await plotStage.getAttribute("data-viewport");
  const bounds = await plotStage.boundingBox();
  if (!bounds) throw new Error("function_plot_stage_bounds_missing");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.6);
  await page.mouse.up();
  await expect(plotStage).not.toHaveAttribute("data-viewport", viewportBeforeDrag ?? "");
  await expect(stage.getByRole("button", { name: "vertex" })).toBeVisible();
  const beforeSelection = await plotStage.screenshot();
  await stage.getByRole("button", { name: "vertex" }).click();
  await expect(stage.getByRole("button", { name: "vertex" })).toHaveAttribute("aria-pressed", "true");
  const afterSelection = await plotStage.screenshot();
  expect(afterSelection.equals(beforeSelection)).toBe(false);
  await stage.getByRole("button", { name: "vertex" }).focus();
  await page.keyboard.press("Space");
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  await expect(page.getByTestId("function-plot-scene-metadata")).toHaveText("1|vertex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders function plot deterministically on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?function-plot-fixture");
  await expectFunctionPlotRendered(page);
});

test("keeps function plot usable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?function-plot-fixture");
  await expectFunctionPlotRendered(page);
});
