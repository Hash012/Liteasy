import { expect, test } from "@playwright/test";

async function expectGeometry3DRendered(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("geometry-3d-browser-fixture");
  await expect(stage).toBeVisible();
  const webglProbe = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return {
      context: Boolean(gl),
      fragmentPrecision: gl?.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)?.precision ?? null,
      precision: gl?.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.MEDIUM_FLOAT)?.precision ?? null,
      version: gl ? String(gl.getParameter(gl.VERSION)) : null
    };
  });
  expect(webglProbe).toMatchObject({ context: true });
  expect(webglProbe.precision, JSON.stringify(webglProbe)).not.toBeNull();
  expect(webglProbe.fragmentPrecision, JSON.stringify(webglProbe)).not.toBeNull();
  const runtime = stage.getByTestId("geometry-3d-runtime");
  await expect.poll(async () => {
    const state = await runtime.getAttribute("data-runtime");
    const diagnostic = await runtime.getAttribute("data-diagnostic");
    return state === "webgl" ? state : `${state}:${diagnostic}`;
  }).toBe("webgl");
  const svg = stage.getByRole("img", { name: "cube, mid-section", includeHidden: true });
  await expect(svg.locator("#object-cube")).toHaveCount(1);
  await expect(svg.locator("#object-mid-section")).toHaveCount(1);
  const canvas = stage.getByTestId("geometry-3d-canvas");
  await expect(canvas).toBeVisible();
  const pixelEvidence = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const gl = target.getContext("webgl2") ?? target.getContext("webgl");
    if (!gl) return { nonBackgroundPixels: 0, webgl: false };
    const pixels = new Uint8Array(target.width * target.height * 4);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBackgroundPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) nonBackgroundPixels += 1;
    }
    return { nonBackgroundPixels, webgl: true };
  });
  expect(pixelEvidence.webgl).toBe(true);
  expect(pixelEvidence.nonBackgroundPixels).toBeGreaterThan(100);
  const beforeRotation = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("geometry_3d_canvas_bounds_missing");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect.poll(async () => {
    const states = await Promise.all([
      stage.getByRole("button", { name: "cube" }).getAttribute("aria-pressed"),
      stage.getByRole("button", { name: "mid-section" }).getAttribute("aria-pressed")
    ]);
    return states.filter((state) => state === "true").length;
  }).toBe(1);
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.55, { steps: 8 });
  await page.mouse.up();
  const afterRotation = await canvas.screenshot();
  expect(afterRotation.equals(beforeRotation)).toBe(false);
  const cubeButton = stage.getByRole("button", { name: "cube" });
  if (await cubeButton.getAttribute("aria-pressed") !== "true") await cubeButton.click();
  await expect(cubeButton).toHaveAttribute("aria-pressed", "true");
  const selectedScene = await canvas.screenshot();
  await stage.getByRole("button", { name: "重置三维几何视图" }).click();
  const resetScene = await canvas.screenshot();
  expect(resetScene.equals(selectedScene)).toBe(false);
  expect(await svg.evaluate((element) => element.outerHTML.includes("<script"))).toBe(false);
  await expect(page.getByTestId("geometry-3d-scene-metadata")).toHaveText("6|cube,mid-section");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders interactive 3d geometry on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?geometry-3d-fixture");
  await expectGeometry3DRendered(page);
});

test("keeps interactive 3d geometry usable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?geometry-3d-fixture");
  await expectGeometry3DRendered(page);
});
