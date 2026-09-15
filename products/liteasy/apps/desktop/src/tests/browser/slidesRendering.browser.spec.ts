import { expect, test } from "@playwright/test";

test("renders slide Markdown and source entities in Chromium while mounting only the selected page", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/src/tests/browser/fixtures/slides-rendering.html");
  await expect(page.getByText("固定渲染测试资料，仅验证界面；不调用模型或业务服务。")).toBeVisible();

  const firstPage = page.getByRole("article", { name: "第 1 页幻灯片" });
  await expect(firstPage).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "第 2 页幻灯片" })).toHaveCount(0);
  await expect(firstPage.getByRole("table")).toBeVisible();
  await expect(firstPage.getByRole("cell", { name: "可读表格" })).toBeVisible();
  await expect(firstPage.locator(".katex")).toBeVisible();
  await expect(firstPage.locator(".katex-error")).toHaveCount(0);
  const diagram = firstPage.getByRole("region", { name: "Mermaid 图表" }).locator(".mermaid-preview__svg svg");
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText("分析证据");
  const figure = firstPage.getByRole("img", { name: "渲染测试示意图" });
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toBeVisible();
  await expect.poll(() => figure.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await expect(firstPage.getByText("本页引用原文", { exact: true })).toBeVisible();
  await expect(firstPage.getByRole("blockquote")).toContainText("始终保留可读原文");
  const openSource = firstPage.getByRole("button", { name: "打开原文证据 1：可视化测试论文 第 3 页" });
  await expect(openSource).toHaveText("可视化测试论文 · 第 3 页");
  expect(await page.locator("body").innerText()).not.toContain("evidence-browser-slide-fixture");
  await openSource.click();
  await expect(page.getByRole("complementary", { name: "已打开的来源" })).toContainText("已打开：可视化测试论文 · 第 3 页");

  await expect(page.getByLabel("演讲备注", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "显示演讲备注" }).click();
  await expect(page.getByLabel("演讲备注", { exact: true })).toContainText("第一页备注");
  await expect(page.getByLabel("演讲备注", { exact: true }).locator(".katex")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("slides-rendering-page-1.png"), fullPage: true });

  await page.getByRole("button", { name: "下一页幻灯片" }).click();
  const secondPage = page.getByRole("article", { name: "第 2 页幻灯片" });
  await expect(secondPage).toBeVisible();
  await expect(secondPage.getByRole("heading", { name: "第二页独立内容" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(firstPage).toHaveCount(0);
  await expect(page.locator(".mermaid-preview__svg svg")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "渲染测试示意图" })).toHaveCount(0);
  await expect(page.getByLabel("演讲备注", { exact: true })).toContainText("第二页备注");
  await expect(page.getByText("第一页备注")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下一页幻灯片" })).toBeDisabled();
  await page.getByRole("button", { name: "收起演讲备注" }).click();
  await expect(page.getByLabel("演讲备注", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("slides-rendering-page-2.png"), fullPage: true });

  await page.getByRole("combobox", { name: "选择幻灯片" }).selectOption("0");
  await expect(firstPage).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "上一页幻灯片" })).toBeDisabled();
  await expect(diagram).toBeVisible();
  expect(pageErrors).toEqual([]);
});
