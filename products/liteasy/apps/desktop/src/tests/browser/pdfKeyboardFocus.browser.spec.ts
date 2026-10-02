import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

for (const zoom of [1.25, 1.5, 2]) {
  test(`document find keeps IME and return focus at ${zoom * 100}% CSS zoom`, async ({ page }) => {
    const bytes = await readFile(resolve("../../../../development/test-data/pdf-selection/glyph-boundaries.pdf"));
    await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: bytes, contentType: "application/pdf" }));
    await page.setViewportSize({ width: 1680, height: 1050 });
    const documentResponse = page.waitForResponse((response) => response.url().endsWith("/manual-preview/das24a.pdf"));
    await page.goto("/?pdf-highlight-fixture#keyboard-focus");
    await documentResponse;
    await expect(page.locator(".pdf-text-layer").first()).toContainText("WiWi tail");
    // Explicit synthetic browser zoom; this does not claim OS scaling coverage.
    await page.evaluate((scale) => { document.documentElement.style.zoom = String(scale); }, zoom);
    const trigger = page.getByRole("button", { name: "在文档中搜索", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const search = page.getByRole("textbox", { name: "搜索文档内容" });
    await expect(search).toBeFocused();
    await search.fill("WiWi");
    await search.evaluate((input) => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "研" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", isComposing: true }));
    });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await search.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "研究" })));
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const stage = page.getByLabel("PDF 页面滚动区");
    await stage.focus();
    await page.keyboard.press("Control+f");
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(stage).toBeFocused();
  });
}
