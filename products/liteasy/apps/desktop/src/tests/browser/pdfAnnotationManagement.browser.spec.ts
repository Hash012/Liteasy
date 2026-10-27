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
  await expect(page.getByLabel("PDF 阅读工作区", { exact: true })).toHaveClass(/sidebar-collapsed/);
  await sidebar.getByRole("button", { name: "展开 PDF 左侧栏", exact: true }).click();
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
  // Highlight colors stay on the marker; the excerpt remains a neutral reading surface.
  await expect(sidebar.locator(".pdf-annotation-item").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(sidebar.locator(".annotation-color-indicator").first()).toBeVisible();
  const summary = summaries.first();
  await summary.hover();
  await expect(sidebar.locator(".pdf-annotation-page, .pdf-annotation-status-icon")).toHaveCount(0);
  await expect(page.getByRole("menu", { name: /^批注信息：/ })).toHaveCount(0);
  const contentRightGap = await summary.evaluate(element => {
    const content = element.querySelector(".pdf-annotation-summary-content")!.getBoundingClientRect();
    return element.getBoundingClientRect().right - content.right - Number.parseFloat(getComputedStyle(element).paddingRight);
  });
  expect(contentRightGap).toBeLessThanOrEqual(1);
  await summary.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "批注信息：Evidence first", exact: true });
  await expect(menu.getByRole("img", { name: "未公开到论坛", exact: true })).toBeVisible();
  await expect(menu.getByText("未公开到论坛", { exact: true })).toBeVisible();
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await summary.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "定位原文 · 第 1 页", exact: true }).click();
  await expect(sidebar.getByText("已定位到第 1 页的高亮。", { exact: true })).toBeVisible();
  await expect(menu).toHaveCount(0);
  const countFont = await sidebar.getByLabel("批注检索结果").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(countFont).toBeCloseTo(fontSize * 12 / 14, 2);
  await summaries.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaries.last()).toBeFocused();
  await page.keyboard.press("Control+Enter");
  await expect(sidebar.getByText("已定位到第 1 页的高亮。", { exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "筛选蓝色批注" }).focus();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByRole("button", { name: "筛选蓝色批注" })).toHaveAttribute("aria-pressed", "true");
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

for (const fontSize of [14, 24]) test(`new colors persist and filter with keyboard at font size ${fontSize}`, async ({ page }, info) => {
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
  await page.evaluate(async () => {
    const storagePath = "/src/app/features/pdf/pdfAnnotationStorage.ts", identityPath = "/src/app/features/paper-identity/paperIdentity.ts";
    const storage = await import(storagePath), identity = await import(identityPath);
    const paper = { id: "manual-das24a-preview", sourcePath: new URL("/manual-preview/das24a.pdf", location.origin).href, title: "das24a.pdf" };
    localStorage.setItem(storage.pdfAnnotationStorageKey(paper), JSON.stringify(["orange", "purple", "cyan", "gray"].map((color, index) => ({
      id: `color-${color}`, page: 1, excerpt: `Evidence ${color}`, note: `Comment ${color}`, kind: "highlight", color, text: "高亮",
      paperIdentity: identity.resolvePaperIdentity(paper), rects: [{ left: 10, top: 15 + index * 10, width: 30, height: 3 }],
      createdAt: "2026-10-15", updatedAt: "2026-10-15", revision: 1, publication: { desiredVisibility: "private", state: "not_published" }
    }))));
  });
  await page.reload();
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty({ timeout: 30_000 });
  const sidebar = page.getByRole("complementary", { name: "PDF 左侧批注栏" });
  await sidebar.getByRole("button", { name: "展开 PDF 左侧栏", exact: true }).click();
  const summaries = sidebar.getByRole("button", { name: /^编辑批注：/ });
  await expect(summaries).toHaveCount(4);
  await expect(sidebar.getByRole("combobox", { name: "筛选批注颜色" })).toHaveCount(0);
  await expect(sidebar.getByRole("group", { name: "按批注颜色筛选" }).getByRole("button")).toHaveCount(4);
  const purpleFilter = sidebar.getByRole("button", { name: "筛选紫色批注" });
  await purpleFilter.focus(); await page.keyboard.press("Enter");
  await expect(purpleFilter).toHaveAttribute("aria-pressed", "true");
  await expect(summaries).toHaveCount(1);
  await page.keyboard.press("Space"); await expect(summaries).toHaveCount(4);
  await summaries.filter({ hasText: "Evidence orange" }).click();
  const palette = sidebar.locator(".color-selector");
  expect(await palette.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`annotation-colors-${fontSize}.png`) });
  await sidebar.getByRole("button", { name: "选择紫色高亮", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "筛选橙色批注" })).toHaveCount(0);
  await expect(purpleFilter).toHaveText(/2/);
  await page.reload();
  await expect(page.locator(".pdf-text-layer").first()).not.toBeEmpty({ timeout: 30_000 });
  await sidebar.getByRole("button", { name: "展开 PDF 左侧栏", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "筛选紫色批注" })).toHaveText(/2/);
  await sidebar.getByRole("button", { name: "批注", exact: true }).dblclick();
  const overview = page.getByRole("region", { name: "全部批注", exact: true });
  await overview.getByRole("button", { name: "筛选紫色批注" }).click();
  await expect(overview.getByRole("listitem")).toHaveCount(2);
  await expect(overview).toContainText("Evidence orange");
  await expect(overview).toContainText("Evidence purple");
});
