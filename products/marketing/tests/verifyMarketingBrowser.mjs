import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.MARKETING_BASE_URL || "http://127.0.0.1:8080";
const screenshotDir = process.env.MARKETING_SCREENSHOT_DIR || "/tmp";
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "/home/octopus/Liteasy/products/liteasy/apps/desktop/node_modules/playwright/index.mjs";
const { chromium } = await import(playwrightModule);
await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await page.getByRole("tab", { name: "核对依据" }).click();
  assert.equal(await page.locator("[data-workflow-title]").textContent(), "核对依据");

  const figureTab = page.getByRole("tab", { name: "论文原图" });
  await figureTab.focus();
  await figureTab.press("ArrowRight");
  assert.equal(await page.locator("[data-result-title]").textContent(), "结构表达");

  await page.getByRole("button", { name: "聚焦关联" }).click();
  assert.equal(await page.locator("[data-association-title]").textContent(), "聚焦关联");

  await page.locator('[data-waitlist-form] input[name="email"]').fill("reader@example.com");
  await page.locator('[data-waitlist-form] select[name="role"]').selectOption({ label: "研究生" });
  await page.locator("[data-waitlist-form]").evaluate((form) => form.requestSubmit());
  await page.getByText("体验申请入口尚未开放").waitFor();
  assert.equal(
    await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    true
  );
  await page.screenshot({ path: `${screenshotDir}/liteasy-marketing-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-menu-toggle]").click();
  await page.getByRole("link", { name: "加入体验计划" }).first().click();
  assert.equal(await page.locator("[data-menu-toggle]").getAttribute("aria-expanded"), "false");
  await page.screenshot({ path: `${screenshotDir}/liteasy-marketing-mobile.png`, fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow: ${overflow}px`);
} finally {
  await browser.close();
}
