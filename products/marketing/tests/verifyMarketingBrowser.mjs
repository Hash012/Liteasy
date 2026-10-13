import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.MARKETING_BASE_URL || "http://127.0.0.1:8080";
const screenshotDir = process.env.MARKETING_SCREENSHOT_DIR || "/tmp";
const playwrightModule = process.env.PLAYWRIGHT_MODULE || fileURLToPath(new URL("../../liteasy/apps/desktop/node_modules/playwright/index.mjs", import.meta.url));
const { chromium } = await import(playwrightModule);
async function verifyResultSizes(page) {
  const sizes = [];
  for (const label of ["论文原图", "结构表达", "科学图解", "数学与几何", "过程演示"]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.locator("[data-result-preview] img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    const panel = await page.locator("#result-panel").boundingBox();
    const preview = await page.locator("[data-result-preview]").boundingBox();
    const content = await page.locator("[data-result-preview] > *").boundingBox();
    sizes.push({ panel: panel.height, preview: preview.height });
    assert.ok(content.y >= preview.y - 1 && content.y + content.height <= preview.y + preview.height + 1, `${label}: preview content fits`);
  }
  for (const field of ["panel", "preview"]) {
    assert.ok(Math.max(...sizes.map((size) => size[field])) - Math.min(...sizes.map((size) => size[field])) < 1, `${field}: five modes use the same height`);
  }
}

await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  assert.equal(await page.locator(".hero-media img").getAttribute("src"), "assets/new/program-main.webp");
  assert.equal(await page.locator(".evidence-visual img").getAttribute("src"), "assets/new/proof.webp");
  for (const [index, label] of ["打开文献", "看见核心", "选择深入", "核对依据", "留下理解"].entries()) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForFunction((title) => document.querySelector("[data-workflow-title]").textContent === title, label);
    const active = page.locator(".workflow-scene.is-active img");
    assert.equal(await active.getAttribute("src"), `assets/new/workflow-${index + 1}.webp`);
    assert.equal(await page.locator("[data-workflow-original]").getAttribute("href"), `assets/new/workflow-${index + 1}.png`);
  }
  // Rapid selection must settle on the last requested picture, even while images decode.
  await page.evaluate(() => {
    ["core", "verify", "explore"].forEach((step) => document.querySelector(`[data-step="${step}"][role="tab"]`).click());
  });
  await page.waitForFunction(() => document.querySelector("[data-workflow-media]").dataset.focus === "explore");
  assert.equal(await page.locator(".workflow-scene.is-active img").getAttribute("src"), "assets/new/workflow-3.webp");
  assert.equal(await page.locator('[data-result="illustration"]').count(), 0);
  for (const [label, asset] of [["论文原图", "new/paper-read.webp"], ["结构表达", "new/mindmap.webp"], ["科学图解", "science-optics.svg"]]) {
    await page.getByRole("tab", { name: label }).click();
    assert.equal(await page.locator("[data-result-preview] img").getAttribute("src"), `assets/${asset}`);
    await page.locator("[data-result-preview] img").evaluate((image) => image.decode());
  }
  for (const [label, selector] of [["数学与几何", ".math-stage"], ["过程演示", ".process-stage"]]) {
    await page.getByRole("tab", { name: label }).click();
    assert.equal(await page.locator(selector).count(), 1);
  }
  assert.deepEqual(errors, []);

  await verifyResultSizes(page);
  await page.getByRole("tab", { name: "核对依据" }).click();
  await page.waitForFunction(() => document.querySelector("[data-workflow-title]").textContent === "核对依据");

  const figureTab = page.getByRole("tab", { name: "论文原图" });
  await figureTab.focus();
  await figureTab.press("ArrowRight");
  assert.equal(await page.locator("[data-result-title]").textContent(), "结构表达");

  await page.getByRole("button", { name: "聚焦关联" }).click();
  assert.equal(await page.locator("[data-association-title]").textContent(), "聚焦关联");

  let waitlistPayload;
  await page.route("**/api/waitlist", async (route) => {
    waitlistPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "体验申请已提交。安装包准备完成后，我们将通过邮件通知你。" })
    });
  });
  await page.getByRole("link", { name: "Download" }).click();
  await page.getByText("安装包面向已提交体验申请的用户开放").waitFor();
  await page.locator('[data-waitlist-form] input[name="email"]').fill("reader@example.com");
  const role = page.locator('[data-waitlist-form] select[name="role"]');
  assert.equal(await role.evaluate((element) => element.validity.valueMissing), true);
  await page.locator("[data-waitlist-form]").evaluate((form) => form.requestSubmit());
  assert.equal(waitlistPayload, undefined);
  await role.selectOption({ label: "研究生" });
  await page.locator("[data-waitlist-form]").evaluate((form) => form.requestSubmit());
  await page.getByText("体验申请已提交").waitFor();
  assert.equal(waitlistPayload.role, "研究生");
  assert.equal(waitlistPayload.email, "reader@example.com");
  for (const image of await page.locator('img[src][loading="lazy"]').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => element.decode());
  }
  assert.equal(
    await page.locator("img").evaluateAll((images) => images.filter((image) => image.hasAttribute("src")).every((image) => image.complete && image.naturalWidth > 0)),
    true
  );
  await page.screenshot({ path: `${screenshotDir}/liteasy-marketing-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.ok((await page.locator('[data-waitlist-form] select[name="role"]').boundingBox()).height >= 44);
  await page.locator("[data-menu-toggle]").click();
  await page.getByRole("link", { name: "加入体验计划" }).first().click();
  assert.equal(await page.locator("[data-menu-toggle]").getAttribute("aria-expanded"), "false");
  for (const label of ["打开文献", "看见核心", "选择深入", "核对依据", "留下理解"]) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForFunction((title) => document.querySelector("[data-workflow-title]").textContent === title, label);
  }
  await verifyResultSizes(page);
  await page.getByRole("tab", { name: "结构表达" }).click();
  await page.locator("[data-result-preview] img").evaluate((image) => image.decode());
  await page.screenshot({ path: `${screenshotDir}/liteasy-marketing-mobile.png`, fullPage: true });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("tab", { name: "留下理解" }).click();
  await page.waitForFunction(() => document.querySelector("[data-workflow-media]").dataset.focus === "keep");
  assert.ok(await page.locator(".workflow-scene.is-active").evaluate((scene) => getComputedStyle(scene).transitionDuration.split(",").every((duration) => parseFloat(duration) < .001)));
  assert.deepEqual(errors, []);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow: ${overflow}px`);
} finally {
  await browser.close();
}
