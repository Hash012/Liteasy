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
