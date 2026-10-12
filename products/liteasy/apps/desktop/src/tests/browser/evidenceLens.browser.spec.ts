import { expect, test, type Page } from "@playwright/test";
const fixture = "/src/tests/browser/fixtures/evidence-lens.html";
const summary = (page: Page) => page.getByRole("button", { name: /2 篇来源.*100 处引用/ });
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.locator(".evidence-lens").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

for (const width of [320, 360, 480, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`${width}px ${theme}: evidence stays readable and bounded`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme as "light" | "dark", reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${fixture}?theme=${theme}`);
      await expect(summary(page)).toBeVisible();
      await noHorizontalOverflow(page);
      await summary(page).click();
      await page.getByRole("button", { name: /查看论断 1：/ }).click();
      const peek = page.getByRole("dialog", { name: "论断与证据" });
      await expect(peek).toBeVisible();
      await expect(peek.getByText("关系未核验", { exact: true })).toHaveCount(2);
      await expect(peek.getByText("仅摘要", { exact: true })).toBeVisible();
      const box = await peek.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(Math.min(380, width));
      expect(box!.height).toBeLessThanOrEqual(421);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`peek-${width}-${theme}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /查看论断 1：/ })).toBeFocused();
      await page.getByRole("button", { name: "查看全部证据" }).click();
      await page.getByRole("combobox", { name: "筛选论断" }).selectOption("contested");
      await expect(page.getByRole("region", { name: "证据详情" })).toContainText("有分歧");
      await noHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`inspector-${width}-${theme}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "查看全部证据" })).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}

test("200% content zoom preserves keyboard access and does not add horizontal scrolling", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.goto(`${fixture}?theme=dark`);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  await summary(page).focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /查看论断 1：/ }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "关闭证据预览" })).toBeFocused();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("content-zoom-200-dark.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /查看论断 1：/ })).toBeFocused();
});

test("production message evidence adapter preserves actual source navigation", async ({ page }) => {
  await page.goto(`${fixture}?entry=message`);
  await page.getByRole("button", { name: /1 篇来源.*1 处引用.*未逐条核验/ }).click();
  await page.getByRole("button", { name: "查看全部证据" }).click();
  await expect(page.locator(".evidence-lens .content-view .markdown-content")).toContainText("消息入口保存的真实测试摘录。");
  await page.getByRole("button", { name: "打开原文" }).click();
  await expect(page.getByRole("complementary", { name: "已打开的来源" })).toHaveText("消息原文：fixture-paper 第 3 页");
});

test("records 50-claim 100-passage expansion latency with bounded initial DOM", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 480, height: 1000 });
  await page.goto(fixture);
  await expect(summary(page)).toBeVisible();
  const latencyMs = await page.evaluate(async () => {
    const start = performance.now();
    (document.querySelector(".evidence-lens__summary") as HTMLButtonElement).click();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return performance.now() - start;
  });
  await expect(page.getByRole("button", { name: /查看论断/ })).toHaveCount(4);
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(latencyMs).toBeLessThan(1000);
  await testInfo.attach("evidence-expansion-metrics", { body: JSON.stringify({ fixture: true, claims: 50, passages: 100, latencyMs, renderedClaims: 4 }), contentType: "application/json" });
});

test("source-only answers expose excerpts immediately and keep checks secondary", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`${fixture}?entry=message&theme=dark`);
  const trigger = page.getByRole("button", { name: /1 篇来源.*1 处引用/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator(".evidence-lens .content-view .markdown-content")).toContainText("消息入口保存的真实测试摘录。");
  await expect(page.locator("details.evidence-lens__checks")).not.toHaveAttribute("open", "");
  await page.locator("details.evidence-lens__checks summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("尚无独立核验记录。引用存在不代表结论成立。")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "打开原文" }).click();
  await expect(page.getByRole("complementary")).toHaveText("消息原文：fixture-paper 第 3 页");
  await page.screenshot({ path: testInfo.outputPath("source-preview-360-dark.png"), fullPage: true });
});


for (const theme of ["light", "dark"]) {
  test(`actual message list and application styles preserve evidence access at 320px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto(`${fixture}?entry=assistant&theme=${theme}`);
    await page.getByRole("button", { name: /1 篇来源.*1 处引用/ }).click();
    await expect(page.locator(".evidence-lens .content-view .markdown-content")).toContainText("消息入口保存的真实测试摘录。");
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "打开原文" }).click();
    await expect(page.getByRole("complementary")).toHaveText("消息原文：fixture-paper 第 3 页");
    await page.screenshot({ path: testInfo.outputPath(`message-list-320-${theme}.png`), fullPage: true });
  });
}
