import { expect, test } from "@playwright/test";

test("explicit short mentions retain editor geometry and open a single source preview", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 891, height: 1898 });
  await page.goto("/src/tests/browser/fixtures/composer-context.html");
  const input = page.getByPlaceholder("输入你的问题或命令");
  await expect(input).toHaveValue(/请比较 Not All Samples.*§2.4/);
  await expect(page.locator(".assistant-context-token-row")).toHaveCount(0);
  const mention = page.locator(".assistant-input-highlight .resource-reference-link");
  await expect(mention).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("composer-review-s5-891x1898.png") });
  for (const zoom of [1, 1.5, 2]) {
    await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
    const geometry = await page.locator(".assistant-input-editor").evaluate(root => {
      const input = root.querySelector("textarea")!, mirror = root.querySelector(".assistant-input-highlight")!;
      return { editor: getComputedStyle(input).fontSize, mirror: getComputedStyle(mirror).fontSize, text: input.value, rendered: mirror.textContent?.trim(), overflow: root.scrollWidth > root.clientWidth };
    });
    expect(geometry.editor).toBe(geometry.mirror);
    expect(geometry.rendered).toBe(geometry.text.trim());
    expect(geometry.overflow).toBe(false);
  }
  await page.evaluate(() => { document.body.style.zoom = "1"; });
  await mention.click();
  const preview = page.getByLabel("引用内容预览", { exact: true });
  await expect(preview).toContainText("The selected evidence");
  await expect(preview.getByRole("button", { name: /移除上下文/ })).toBeVisible();
  await expect(input).toHaveValue(/请比较 Not All Samples/);
  await page.screenshot({ path: testInfo.outputPath("composer-source-preview.png") });
  await preview.getByRole("button", { name: /移除上下文/ }).click();
  await expect(mention).toHaveCount(0);
});

test("light mode selections expose contrasting native ink instead of the mirror", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/composer-context.html");
  const editor = page.getByPlaceholder("输入你的问题或命令");
  await editor.fill("$artifact-generate 浅色选中文字");
  await editor.press("ControlOrMeta+a");
  await expect(page.locator(".assistant-input-editor")).toHaveClass(/has-text-selection/);
  await expect(page.locator(".assistant-input-highlight")).toHaveCSS("visibility", "hidden");
  const colors = await editor.evaluate(element => {
    const style = getComputedStyle(element, "::selection");
    return { color: style.color, background: style.backgroundColor, ink: getComputedStyle(element).color };
  });
  expect(colors).toEqual({ color: "rgb(255, 255, 255)", background: "rgb(15, 108, 189)", ink: "rgb(36, 36, 36)" });
  await page.screenshot({ path: info.outputPath("light-selection-contrast.png") });
  await editor.press("ArrowRight");
  await expect(page.locator(".assistant-input-highlight")).toHaveCSS("visibility", "visible");
});

test("a paper context opens the original PDF without Markdown and navigates pages", async ({ page }, info) => {
  test.setTimeout(60000);
  // Exercise scroll events between React renders, as on slower Windows devices.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const { readFile } = await import("node:fs/promises");
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/source-preview.pdf", import.meta.url));
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?pdf-highlight-fixture#importable");
  const editor = page.getByPlaceholder("输入你的问题或命令");
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.fill("@das24a");
  await editor.press("Tab");
  const link = page.locator(".assistant-input-highlight .resource-reference-link");
  await expect(link).toBeVisible();
  await link.click();
  const preview = page.getByLabel("引用内容预览", { exact: true });
  await expect(preview.getByRole("region", { name: "原始 PDF 预览" })).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await expect(preview.locator("canvas")).toBeVisible();
  await expect(preview).not.toContainText("正文尚未就绪");
  await expect(preview).not.toContainText("来源预览不可用");
  expect(await preview.locator("canvas").evaluate(canvas => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] < 180 && data[index + 3] > 0) dark++;
    return dark;
  })).toBeGreaterThan(100);
  await preview.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(preview.getByRole("region", { name: "原始 PDF 预览" })).toHaveAttribute("aria-busy", "false");
  await expect(preview).toContainText("第 2 /");
  await page.screenshot({ path: info.outputPath("original-pdf-source-preview.png") });
  await preview.getByRole("button", { name: "打开原文件" }).click();
  await page.waitForFunction(() => {
    const stage = document.querySelector(".pdf-stage");
    return stage && Math.abs(stage.scrollHeight - stage.clientHeight - stage.scrollTop) <= 1;
  });
  await expect(page.getByLabel("当前页码")).toHaveValue("2");
  await expect(preview.getByRole("alert")).toHaveCount(0);
});
