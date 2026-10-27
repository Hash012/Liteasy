import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const fontSize of [14, 24]) test(`reading defaults and overflow tools preserve PDF width at font size ${fontSize}`, async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript((size) => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.font_size": String(size), "view.display_scale": "100" }));
  }, fontSize);
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 2200, height: 1200 });
  await page.goto("/?pdf-highlight-fixture#reading-layout");
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('[data-region="bottom"] .assistant-pane')).toBeVisible();
  await expect(page.locator('[data-region="right"]')).not.toBeVisible();
  await expect(page.getByLabel("PDF 阅读工作区", { exact: true })).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole("button", { name: "批注选项", exact: true })).toHaveCount(0);
  const toolbar = page.getByRole("toolbar", { name: "PDF 导航工具栏" });
  await expect(toolbar).toHaveAttribute("data-compact", "false");
  await page.screenshot({ path: info.outputPath(`reading-default-${fontSize}.png`) });

  // Narrow the reader independently of the window, as happens when splitting a pane.
  const reader = page.getByLabel("PDF 阅读器", { exact: true });
  await reader.evaluate(element => { element.style.width = "420px"; element.style.maxWidth = "420px"; });
  await expect(toolbar).toHaveAttribute("data-compact", "true");
  await expect(toolbar.getByRole("spinbutton", { name: "当前页码" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "在文档中搜索" })).toBeVisible();
  await expect(page.getByRole("button", { name: "按比例放大 PDF", exact: true })).toHaveCount(0);
  expect(await toolbar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const more = toolbar.getByRole("button", { name: "更多阅读工具", exact: true });
  await more.click();
  const overflow = page.locator(".pdf-reader-overflow");
  for (const option of await overflow.getByRole("group", { name: "页面布局选项" }).getByRole("button").all()) {
    await expect(option).toHaveCSS("white-space", "nowrap");
    expect(await option.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  await overflow.getByRole("button", { name: "按比例放大 PDF", exact: true }).click();
  await expect(overflow.getByLabel("PDF 显示比例 105%", { exact: true })).toBeVisible();
  await overflow.getByRole("button", { name: "单页", exact: true }).click();
  await expect(reader.locator(".pdf-page-list")).toHaveClass(/layout-single/);
  await overflow.getByRole("button", { name: "手绘涂鸦", exact: true }).click();
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "结束手绘", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "手绘工具" })).toHaveCount(0);
  await more.click();
  await expect(overflow.getByLabel("PDF 显示比例 105%", { exact: true })).toBeVisible();
  await overflow.screenshot({ path: info.outputPath(`reading-overflow-${fontSize}.png`) });
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "在文档中搜索" }).click();
  await page.getByRole("textbox", { name: "搜索文档内容" }).fill("WiWi");
  await expect(reader.locator(".search-result.current")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭文档搜索" }).click();
  await reader.evaluate(element => { element.style.removeProperty("width"); element.style.removeProperty("max-width"); });
  await expect(toolbar).toHaveAttribute("data-compact", "false");
  await expect(toolbar.getByLabel("PDF 显示比例 105%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开 PDF 左侧栏", exact: true }).click();
  await expect(page.getByRole("button", { name: "批注选项", exact: true })).toBeVisible();
});
