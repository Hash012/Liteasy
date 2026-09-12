import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

for (const scenario of [
  { reverse: false, zoom: 100 },
  { reverse: true, zoom: 100 },
  { reverse: false, zoom: 120 },
  { reverse: true, zoom: 80 }
]) {
  test(`PDF glyph boundaries agree with copied and saved text (${scenario.zoom}%, reverse=${scenario.reverse})`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const pdf = await readFile(resolve("../../../../development/test-data/pdf-selection/glyph-boundaries.pdf"));
    await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
    await page.setViewportSize({ height: 1220, width: 2048 });
    await page.goto("/?pdf-highlight-fixture");
    const text = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer span').filter({ hasText: "WiWi tail" });
    await expect(text).toBeVisible();
    for (let zoom = 100; zoom !== scenario.zoom; zoom += scenario.zoom > 100 ? 5 : -5) {
      await page.getByRole("button", { name: scenario.zoom > 100 ? "按比例放大 PDF" : "按比例缩小 PDF", exact: true }).click();
    }
    await expect(page.getByLabel(`PDF 显示比例 ${scenario.zoom}%`)).toBeVisible();
    await expect(text).toBeVisible();
    await text.scrollIntoViewIfNeeded();
    // These are PDF coordinates from the fixture's Times-Roman advances and 0.5pt Tc, not
    // text-layer measurements. The fourth glyph starts at 103.484 and ends at 110.156.
    // A pointer at 105 has not crossed its midpoint and must select only "WiW".
    const surface = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer');
    const box = await surface.boundingBox();
    if (!box) throw new Error("Missing PDF page surface");
    const startX = box.x + 50.5 / 400 * box.width;
    const endX = box.x + 105 / 400 * box.width;
    const y = box.y + 42 / 300 * box.height;
    await page.mouse.move(scenario.reverse ? endX : startX, y);
    await page.mouse.down();
    await page.mouse.move(scenario.reverse ? startX : endX, y, { steps: 10 });
    await page.mouse.up();
    const preview = page.locator('.pdf-page-shell[data-page="1"] .selection-preview');
    await expect(preview).toHaveCount(1);
    const bounds = await preview.boundingBox();
    expect(bounds!.x).toBeCloseTo(box.x + 50 / 400 * box.width, 0);
    expect(bounds!.x + bounds!.width).toBeCloseTo(box.x + 102.984 / 400 * box.width, 0);
    const menu = page.getByLabel("选中文本批注菜单");
    await menu.getByRole("button", { name: "复制", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("WiW");
    await menu.getByRole("button", { name: "高亮", exact: true }).click();
    const mark = page.locator('.pdf-page-shell[data-page="1"] button.pdf-overlay-mark.highlight');
    await expect(mark).toHaveAttribute("title", "第 1 页：WiW");
    const saved = await mark.boundingBox();
    expect(saved!.x).toBeCloseTo(bounds!.x, 0);
    expect(saved!.width).toBeCloseTo(bounds!.width, 0);
    await page.reload();
    await expect(mark).toHaveAttribute("title", "第 1 页：WiW");
    if (scenario.zoom === 100 && !scenario.reverse) {
      await page.getByRole("button", { name: "在文档中搜索", exact: true }).click();
      await page.getByRole("textbox", { name: "搜索文档内容" }).fill("alpha");
      const searchResult = page.locator('.pdf-page-shell[data-page="1"] .search-result.current');
      await expect(searchResult).toHaveCount(1);
      await page.getByRole("button", { name: "按比例放大 PDF", exact: true }).click();
      await expect(searchResult).toHaveCount(1);
    }
  });
}

test("a drag beginning in the right column does not absorb the preceding left column", async ({ page }) => {
  await page.setViewportSize({ height: 1220, width: 2048 });
  await page.goto("/?pdf-highlight-fixture");

  const target = page.locator('.pdf-page-shell[data-page="3"] .pdf-text-layer span:not(.markedContent)', {
    hasText: "ciative memory"
  }).first();
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("The right-column regression text has no client bounds");

  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(34, box.width * 0.48), box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('[aria-label="选中文本批注菜单"]')).toBeVisible();
  const selected = page.locator('.pdf-page-shell[data-page="3"] .selection-preview');
  await expect(selected).toHaveCount(1);
  const selectedBox = await selected.boundingBox();
  expect(selectedBox).not.toBeNull();
  expect(selectedBox!.x).toBeGreaterThanOrEqual(box.x - 2);
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(box.x + box.width + 2);

  const selectionMenu = page.locator('[aria-label="选中文本批注菜单"]');
  await expect(selectionMenu.getByRole("button", { name: "注释" })).toHaveCount(0);
  await selectionMenu.getByRole("button", { exact: true, name: "高亮" }).click();

  const mark = page.locator('.pdf-page-shell[data-page="3"] button.pdf-overlay-mark.highlight');
  await expect(mark).toHaveCount(1);
  await mark.click();
  const editor = page.getByRole("complementary", { name: /高亮注释编辑器/u });
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "页内批注内容" }).fill("**核心结论**\n\n- 右栏内容");
  const preview = editor.getByLabel("页内批注 Markdown 实时预览");
  await expect(preview.locator("strong")).toHaveText("核心结论");
  await expect(preview.getByRole("listitem")).toHaveText("右栏内容");
});

test("dragging beyond a word right edge includes all of its trailing letters", async ({ page }) => {
  await page.setViewportSize({ height: 1220, width: 2048 });
  await page.goto("/?pdf-highlight-fixture");

  const target = page
    .locator('.pdf-page-shell[data-page="3"] .pdf-text-layer span:not(.markedContent)')
    .filter({ hasText: /^ciative memory \($/u })
    .first();
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const drag = await target.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("Expected a PDF text node");
    const first = document.createRange();
    first.setStart(text, 0);
    first.setEnd(text, 1);
    const last = document.createRange();
    last.setStart(text, 13);
    last.setEnd(text, 14);
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    return {
      endX: lastRect.right + 2,
      startX: firstRect.left + 2,
      y: firstRect.top + firstRect.height / 2
    };
  });

  await page.mouse.move(drag.startX, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.endX, drag.y, { steps: 10 });
  await page.mouse.up();
  await page.getByLabel("选中文本批注菜单").getByRole("button", {
    exact: true,
    name: "高亮"
  }).click();

  const mark = page.locator('.pdf-page-shell[data-page="3"] button.pdf-overlay-mark.highlight');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute("title", "第 3 页：ciative memory");
});
