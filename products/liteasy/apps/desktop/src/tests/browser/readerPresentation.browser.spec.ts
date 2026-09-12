import { expect, test } from "@playwright/test";

test("keeps reader controls compact, colored annotations visible and activity inspectable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="reader-presentation"></div>';
    const fixture = await import("/src/tests/fixtures/readerPresentationBrowserFixture.tsx");
    fixture.mountReaderPresentationFixture(document.getElementById("reader-presentation")!);
  });
  await expect(page.getByLabel("PDF 标题栏")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认文献身份", exact: true })).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "阅读区布局控制" })).toHaveCount(0);
  await page.getByRole("button", { name: "缩略图", exact: true }).click();
  await expect(page.locator(".pdf-thumbnail-mark.highlight")).toHaveCount(1);
  const thumbnailColor = await page.locator(".pdf-thumbnail-mark.highlight").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(thumbnailColor).toBe(await page.locator("button.pdf-overlay-mark.highlight").evaluate((element) => getComputedStyle(element).backgroundColor));
  const step = page.getByRole("button", { name: "分析 核对论文证据" });
  await step.click();
  await expect(page.getByText("已读取选中文献，核对回答与原文的对应关系。")).toBeVisible();
  await page.getByText("查看引用原文").click();
  await expect(page.getByRole("button", { name: /A paper with a long title.*第 1 页/ })).toBeVisible();
  await expect(page.getByText(/local-internal-paper-id/)).toHaveCount(0);
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer span').first()).toBeVisible();
  await expect(page.getByLabel("共 18 页")).toBeVisible();
  const sidebar = await page.getByRole("complementary", { name: "PDF 左侧批注栏" }).boundingBox();
  const toolbar = await page.getByRole("toolbar", { name: "PDF 导航工具栏" }).boundingBox();
  expect(toolbar!.x).toBeGreaterThan(sidebar!.x);
  expect(Math.abs(toolbar!.y - sidebar!.y)).toBeLessThan(10);
  await page.screenshot({ path: "../../../../tmp/reader-ui-fixed.png", fullPage: true });
});
