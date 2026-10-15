import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const fontSize of [14, 24]) test(`annotation management remains usable at font size ${fontSize}`, async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript((size) => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.font_size": String(size), "view.display_scale": "100" }));
  }, fontSize);
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1680, height: 1100 });
  await page.goto("/?pdf-highlight-fixture#annotation-management");
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty({ timeout: 30_000 });
  const seed = await page.evaluate(async () => {
    const storagePath = "/src/app/features/pdf/pdfAnnotationStorage.ts";
    const identityPath = "/src/app/features/paper-identity/paperIdentity.ts";
    const storage = await import(storagePath);
    const identity = await import(identityPath);
    const paper = { id: "manual-das24a-preview", sourcePath: new URL("/manual-preview/das24a.pdf", location.origin).href, title: "das24a.pdf" };
    return { key: storage.pdfAnnotationStorageKey(paper), annotations: ["first", "second"].map((id, index) => ({
      id, page: 1, excerpt: `Evidence ${id}`, note: `Comment ${id}`, kind: "highlight", color: index ? "blue" : "yellow", text: "", paperIdentity: identity.resolvePaperIdentity(paper),
      rects: [{ left: 10, top: 15 + index * 10, width: 30, height: 3 }], createdAt: `2026-10-0${index + 1}`, updatedAt: "2026-10-03", revision: 1,
      publication: { desiredVisibility: "private", state: "not_published" }
    })) };
  });
  await page.addInitScript((data) => localStorage.setItem(data.key, JSON.stringify(data.annotations)), seed);
  await page.reload();
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty({ timeout: 30_000 });
  const sidebar = page.getByRole("complementary", { name: "PDF 左侧批注栏" });
  const summaries = sidebar.getByRole("button", { name: /^编辑批注：/ });
  await expect(summaries).toHaveCount(2, { timeout: 30_000 });
  const controls = sidebar.locator(".pdf-sidebar-controls");
  expect(await controls.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const filters = controls.getByRole("combobox");
  for (const filter of await filters.all()) {
    // Whole controls wrap in a narrow sidebar; their labels stay on one readable line.
    const metrics = await filter.evaluate(element => ({ height: element.getBoundingClientRect().height, font: Number.parseFloat(getComputedStyle(element).fontSize) }));
    expect(metrics.height).toBeLessThanOrEqual(Math.max(36, metrics.font * 2.4));
  }
  await expect(summaries.first().locator(".pdf-annotation-excerpt")).toHaveCSS("font-size", `${fontSize}px`);
  const countFont = await sidebar.getByLabel("批注检索结果").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(countFont).toBeCloseTo(fontSize * 12 / 14, 2);
  await summaries.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaries.last()).toBeFocused();
  await page.keyboard.press("Control+Enter");
  await expect(sidebar.getByText("已定位到第 1 页的高亮。", { exact: true })).toBeVisible();
  await sidebar.getByRole("combobox", { name: "筛选批注颜色" }).click();
  await page.getByRole("option", { name: "蓝色", exact: true }).click();
  await expect(summaries).toHaveCount(1);
  await sidebar.getByRole("button", { name: "清除类型与颜色筛选" }).click();
  await sidebar.getByRole("combobox", { name: "批注排序" }).click();
  await page.getByRole("option", { name: "最近创建", exact: true }).click();
  await expect(summaries.first()).toHaveAccessibleName("编辑批注：Evidence second");
  await summaries.first().click();
  const deleteButton = sidebar.getByRole("button", { name: "删除", exact: true });
  await deleteButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "删除批注确认" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保留批注" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(summaries).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`annotation-management-${fontSize}.png`), fullPage: true });
});
