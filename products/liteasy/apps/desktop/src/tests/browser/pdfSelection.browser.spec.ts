import { expect, test } from "@playwright/test";

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
