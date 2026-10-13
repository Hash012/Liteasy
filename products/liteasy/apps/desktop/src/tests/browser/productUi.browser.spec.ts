import { expect, test } from "@playwright/test";
test("product overlay inherits light/dark tokens, keyboard focus and nonmodal positioning", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto("/src/tests/browser/fixtures/product-ui.html");
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const trigger = page.getByRole("button", { name: "打开原语浮层" }); await trigger.click();
    const overlay = page.getByRole("dialog", { name: "速问原语样板" });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("button", { name: "解释选段", exact: true }).last()).toBeFocused();
    const styles = await overlay.evaluate(element => { const s = getComputedStyle(element); return { color: s.color, background: s.backgroundColor, width: element.getBoundingClientRect().width }; });
    const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(styles.color), b = luminance(styles.background); expect((Math.max(a,b) + .05) / (Math.min(a,b) + .05)).toBeGreaterThanOrEqual(4.5);
    expect(styles.width).toBeLessThanOrEqual(520);
    await overlay.getByRole("textbox", { name: "补充指令（可选）" }).fill("补充说明");
    await overlay.getByRole("textbox").press("Control+Enter"); await expect(overlay.getByRole("status")).toContainText(`动作次数：${theme === "浅色" ? 1 : 2}`);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`gallery-${theme}.png`) });
    await page.keyboard.press("Escape"); await expect(overlay).toHaveCount(0); await expect(trigger).toBeFocused();
  }
});
test("all corners flip/shift inside the viewport and a 320px sheet keeps actions reachable", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/product-ui.html");
  for (const corner of ["左上", "右上", "左下", "右下"]) {
    await page.getByRole("button", { name: corner, exact: true }).click();
    const overlay = page.getByRole("dialog", { name: "速问原语样板" });
    await expect(overlay).toBeVisible();
    const box = (await overlay.boundingBox())!, viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await overlay.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await page.setViewportSize({ width: 320, height: 640 }); await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "打开原语浮层" }).click();
  const sheet = page.getByRole("dialog", { name: "速问原语样板" }); await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(296);
  const action = sheet.getByRole("button", { name: "解释选段", exact: true }).last(); await expect(action).toBeInViewport();
  expect(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ animations: "disabled", path: info.outputPath("gallery-320-forced-colors.png") });
  await page.keyboard.press("Escape"); await expect(sheet).toHaveCount(0);
});

test("system theme follows OS, nonmodal focus stays free, and touch sheets retain 44px targets", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/src/tests/browser/fixtures/product-ui.html");
  await page.getByRole("button", { name: "跟随系统", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  const trigger = page.getByRole("button", { name: "打开原语浮层" });
  await trigger.click();
  const overlay = page.getByRole("dialog", { name: "速问原语样板" });
  await expect(overlay).toHaveAttribute("aria-modal", "false");
  await page.getByRole("button", { name: "浅色", exact: true }).focus();
  await expect(page.getByRole("button", { name: "浅色", exact: true })).toBeFocused();
  // Fluent may light-dismiss after moving focus outside a nonmodal surface.
  if (await overlay.isVisible()) await overlay.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 640 }); await trigger.click();
  await expect(overlay).toHaveAttribute("aria-modal", "true");
  const primary = overlay.getByRole("button", { name: "解释选段", exact: true }).last();
  await expect(primary).toBeFocused();
  expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (let tab = 0; tab < 14; tab++) {
    await page.keyboard.press("Tab");
    expect(await overlay.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ animations: "disabled", path: info.outputPath("gallery-system-touch-sheet.png") });
  await page.keyboard.press("Escape"); await expect(overlay).toHaveCount(0); await expect(trigger).toBeFocused();
  await context.close();
});
