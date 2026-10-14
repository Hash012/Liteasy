import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const fixture = (name: string, type: string) => `data:${type};base64,${readFileSync(fileURLToPath(new URL(`../../../../../../../development/test-data/context-preview/${name}`, import.meta.url))).toString("base64")}`;
for (const [name, type] of [["valid-wide.png", "image/png"], ["valid-tall.png", "image/png"], ["valid.svg", "image/svg+xml"], ["valid.jpg", "image/jpeg"]]) {
  test(`decodes and paints real ${name} bytes into a bounded raster`, async ({ page }) => {
    await page.goto("/src/tests/browser/fixtures/context-preview.html");
    await page.waitForFunction(() => "decodeThumbnail" in window);
    const result = await page.evaluate((url) => (window as any).decodeThumbnail(url), fixture(name, type));
    expect(result.width).toBeGreaterThan(0); expect(result.height).toBeGreaterThan(0);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(320);
    expect(result.pixel[3]).toBeGreaterThan(0);
    expect([result.width, result.height]).toEqual(name === "valid-wide.png" ? [320, 30] : name === "valid-tall.png" ? [30, 320] : [320, 160]);
    expect(result.trace.some((entry: any) => entry.stage === "decode" && entry.outcome === "ok")).toBe(true);
    expect(result.trace.some((entry: any) => entry.stage === "resize" && entry.outcome === "ok")).toBe(true);
  });
}
test("corrupt bytes fail decoding without publishing a thumbnail", async ({ page }) => {
  await page.goto("/src/tests/browser/fixtures/context-preview.html"); await page.waitForFunction(() => "decodeThumbnail" in window);
  const error = await page.evaluate(async (url) => { try { await (window as any).decodeThumbnail(url); return ""; } catch (error) { return String(error); } }, fixture("corrupt-image.bin", "image/png"));
  expect(error).not.toBe("");
});
