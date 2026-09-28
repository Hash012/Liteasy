import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

for (const theme of ["light", "dark"] as const) {
  test(`selection tools stay compact and inside the reader in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => {
      localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.theme": value }));
      localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    }, theme);
    const pdf = await readFile(resolve("../../../../development/test-data/pdf-selection/glyph-boundaries.pdf"));
    await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.goto("/?pdf-highlight-fixture#selection-menu");
    const layer = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer');
    await expect(layer).toContainText("WiWi tail", { timeout: 30_000 });
    const box = (await layer.boundingBox())!;
    await page.mouse.move(box.x + 50.5 / 400 * box.width, box.y + 42 / 300 * box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + 105 / 400 * box.width, box.y + 42 / 300 * box.height, { steps: 10 });
    await page.mouse.up();
    const menu = page.getByLabel("选中文本批注菜单", { exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "选择黄色高亮" })).toHaveAttribute("aria-pressed", "true");
    await menu.getByRole("button", { name: "选择蓝色高亮" }).click();
    await expect(menu.getByRole("button", { name: "选择蓝色高亮" })).toHaveAttribute("aria-pressed", "true");
    await expect(menu.getByRole("button", { name: "选择蓝色高亮" })).toHaveCSS("width", "24px");
    await expect(menu).toHaveCSS("background-color", theme === "dark" ? "rgb(41, 41, 41)" : "rgb(255, 255, 255)");
    for (const width of [1440, 1100]) {
      await page.setViewportSize({ width, height: 650 });
      await expect.poll(async () => menu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const stage = element.closest(".pdf-stage")!.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1 && bounds.left >= stage.left && bounds.right <= stage.right && bounds.top >= stage.top && bounds.bottom <= stage.bottom;
      })).toBe(true);
    }
    await menu.screenshot({ path: testInfo.outputPath(`selection-menu-${theme}.png`) });
    await menu.getByRole("button", { name: "高亮", exact: true }).click();
    await expect(page.locator('button.pdf-overlay-mark.highlight')).toHaveAttribute("title", "第 1 页：WiW");
  });
}
