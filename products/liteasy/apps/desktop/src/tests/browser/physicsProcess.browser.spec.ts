import { expect, test } from "@playwright/test";

async function expectPhysicsProcessRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("physics-process-browser-fixture");
  await expect(stage).toBeVisible();
  const processStage = stage.getByTestId("physics-process-stage");
  const svg = processStage.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("#object-trajectory")).toBeVisible();
  await expect(stage.getByTestId("physics-process-runtime")).toHaveAttribute("data-runtime", "worker");
  const initialScene = await processStage.screenshot();
  await stage.getByRole("button", { name: "下一帧" }).click();
  await expect(stage.getByTestId("physics-process-frame")).toHaveText("1 / 60");
  const nextFrameScene = await processStage.screenshot();
  expect(nextFrameScene.equals(initialScene)).toBe(false);
  await stage.getByRole("slider", { name: "时间" }).fill("20");
  await expect(stage.getByTestId("physics-process-frame")).toHaveText("20 / 60");
  const soughtScene = await processStage.screenshot();
  expect(soughtScene.equals(nextFrameScene)).toBe(false);
  const yBeforeParameter = await processStage.getAttribute("data-current-y");
  await stage.getByRole("slider", { name: "参数 g" }).fill("9.2");
  await expect(stage.getByTestId("physics-process-runtime")).toHaveAttribute("data-runtime", "worker");
  await stage.getByRole("slider", { name: "时间" }).fill("20");
  await expect(processStage).not.toHaveAttribute("data-current-y", yBeforeParameter ?? "");
  await stage.getByRole("button", { name: "播放" }).click();
  await expect(stage.getByRole("button", { name: "暂停" })).toBeVisible();
  await stage.getByRole("button", { name: "暂停" }).click();
  const beforeSelection = await processStage.screenshot();
  await stage.getByRole("button", { name: "trajectory" }).click();
  await expect(stage.getByRole("button", { name: "trajectory" })).toHaveAttribute("aria-pressed", "true");
  const afterSelection = await processStage.screenshot();
  expect(afterSelection.equals(beforeSelection)).toBe(false);
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
