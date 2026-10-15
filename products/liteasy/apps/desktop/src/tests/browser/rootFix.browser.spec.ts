import { expect, test } from "@playwright/test";

test("production composition aggregates boards and uses one spatial presentation in notes, chat and picker", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto("/src/tests/browser/fixtures/root-fix.html");
  await expect(page.getByText("夹具已就绪", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看白板笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await expect(notes.getByRole("button", { name: /^查看笔记 研究白板/ })).toHaveCount(2);
  await notes.getByRole("button", { name: "查看笔记 研究白板 A", exact: true }).click();
  await expect(notes.getByLabel("白板空间预览")).toBeVisible(); await expect(notes.getByLabel("白板空间预览").locator("article")).toHaveCount(20);
  await page.getByRole("link", { name: "白板聊天引用", exact: true }).click();
  await expect(page.getByRole("group", { name: "引用内容预览", exact: true }).getByLabel("白板空间预览")).toBeVisible();
  await page.getByRole("button", { name: "关闭引用预览", exact: true }).click();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await page.getByRole("button", { name: "全部资产", exact: true }).click();
  await page.getByRole("button", { name: "预览 研究白板 A", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("白板空间预览")).toBeVisible();
  await page.screenshot({ path: info.outputPath("board-cross-surface.png"), animations: "disabled" });
});
test("native annotation original opens the rotated cropped tenth PDF page", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/root-fix.html"); await expect(page.getByText("夹具已就绪", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "批注原始 PDF", exact: true }).click();
  await expect(page.getByText("第 10 / 10 页", { exact: true })).toBeVisible();
  await expect(page.getByLabel("第 10 页文字")).toContainText("ORIGINAL PAGE 10");
  await expect(page.locator(".source-pdf-page canvas")).toBeVisible();
  await page.screenshot({ path: info.outputPath("native-page10.png"), animations: "disabled" });
});
for (const width of [360, 680, 1280]) test(`notes compact layout at ${width}px preserves accessible controls`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto("/src/tests/browser/fixtures/root-fix.html"); await expect(page.getByText("夹具已就绪", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看白板笔记", exact: true }).click();
  await expect(page.getByRole("region", { name: "笔记", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`notes-${width}.png`), animations: "disabled" });
});
