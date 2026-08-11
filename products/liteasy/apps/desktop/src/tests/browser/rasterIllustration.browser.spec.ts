import { expect, test } from "@playwright/test";

async function expectRasterIllustrationRendered(page: import("@playwright/test").Page) {
  const fixture = page.getByTestId("raster-illustration-browser-fixture");
  const runtime = fixture.getByTestId("raster-illustration-runtime");
  const stage = fixture.getByLabel("生成插图画布");
  const image = fixture.getByRole("img", { name: "Evidence-bounded input and output process illustration" });

  await expect(runtime).toHaveAttribute("data-runtime", "ready");
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 128);
  await expect(image).toHaveJSProperty("naturalHeight", 96);
  const pixels = await image.evaluate((element) => {
    const imageElement = element as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    if (!context) return { colors: 0, nonWhite: 0 };
    context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    let nonWhite = 0;
    for (let index = 0; index < data.length; index += 4) {
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) nonWhite += 1;
    }
    return { colors: colors.size, nonWhite };
  });
  expect(pixels.colors).toBeGreaterThan(4);
  expect(pixels.nonWhite).toBeGreaterThan(100);

  const initial = await stage.screenshot();
  await fixture.getByRole("button", { name: "放大生成插图" }).click();
  const zoomed = await stage.screenshot();
  expect(zoomed.equals(initial)).toBe(false);

  const viewportBeforeDrag = await stage.getAttribute("data-viewport");
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("raster_stage_bounds_missing");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.58);
  await page.mouse.up();
  await expect(stage).not.toHaveAttribute("data-viewport", viewportBeforeDrag ?? "");

  const beforeSelection = await stage.screenshot();
  await fixture.getByRole("button", { name: "output" }).click();
  await expect(fixture.getByRole("button", { name: "output" })).toHaveAttribute("aria-pressed", "true");
  await expect(stage).toContainText("Output stage");
  const afterSelection = await stage.screenshot();
  expect(afterSelection.equals(beforeSelection)).toBe(false);

  await expect(fixture.getByText("生成插图")).toBeVisible();
  await expect(page.getByTestId("raster-illustration-scene-metadata")).toHaveText("128x96|input,output");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("renders decoded generated raster pixels on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/?raster-illustration-fixture");
  await expectRasterIllustrationRendered(page);
});

test("keeps generated raster controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?raster-illustration-fixture");
  await expectRasterIllustrationRendered(page);
});
