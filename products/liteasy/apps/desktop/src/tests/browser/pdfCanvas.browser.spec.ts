import { expect, test, type Page } from "@playwright/test";

// Two equal pages expose alignment regressions when only one has a margin comment.
async function openReader(page: Page) {
  const content = "BT /F1 18 Tf 40 240 Td (Abstract: Paper annotation example.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  source += `xref\n0 7\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: Buffer.from(source), contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?pdf-highlight-fixture#canvas");
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).toContainText("Abstract", { timeout: 30_000 });
}
const firstPage = (page: Page) => page.locator('.pdf-page-shell[data-page="1"]');

test("content-sized text boxes keep tools outside, insert images, move and restore", async ({ page }, testInfo) => {
  await openReader(page);
  const dock = page.locator(".pane.center");
  await expect(dock.locator(".pane-body").first()).toHaveCSS("padding", "0px");
  await expect(page.locator(".pdf-stage")).toHaveCSS("padding", "2px");
  await page.getByRole("button", { name: "在 PDF 中添加 Markdown 文本框", exact: true }).click();
  const bounds = (await firstPage(page).boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width * .45, bounds.y + bounds.height * .45);
  const box = page.getByRole("region", { name: "Markdown 文本框：第 1 页" });
  const editor = page.getByRole("textbox", { name: "编辑第 1 页 Markdown 文本框" });
  await editor.fill("HELLO!");
  await expect.poll(async () => editor.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "保存 Markdown 文本框", exact: true }).click();
  await expect(box.getByRole("toolbar")).toHaveCount(0);
  await expect(box.locator(".pdf-markdown-text-box-surface")).toHaveText("HELLO!");
  const compact = (await box.boundingBox())!;
  expect(compact.width).toBeLessThan(110);
  expect(compact.height).toBeLessThan(50);
  expect(await box.locator(".pdf-markdown-text-box-surface").evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  await box.click();
  const toolbar = (await box.getByRole("toolbar").boundingBox())!;
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual((await box.boundingBox())!.y);
  await page.getByLabel("文本框图片文件").setInputFiles({
    name: "pixel.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=", "base64")
  });
  await expect(editor).toHaveValue(/attachment:/);
  await page.getByRole("button", { name: "保存 Markdown 文本框", exact: true }).click();
  await expect(box.locator(".pdf-markdown-text-box-surface img")).toBeVisible();
  await box.click();
  const handle = (await page.getByRole("button", { name: "拖动 Markdown 文本框" }).boundingBox())!;
  const before = (await box.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 40, handle.y + handle.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  expect((await box.boundingBox())!.x).toBeLessThan(before.x - 35);
  await page.getByRole("button", { name: "调整 Markdown 文本框透明度" }).click();
  await page.getByRole("slider", { name: "Markdown 文本框透明度" }).fill("50");
  await page.mouse.click(bounds.x + 10, bounds.y + 10);
  await expect(box.getByRole("toolbar")).toHaveCount(0);
  await page.reload();
  await expect(box.locator(".pdf-markdown-text-box-surface img")).toBeVisible();
  await expect(box).toHaveCSS("--pdf-text-box-opacity", "0.5");
  await page.screenshot({ path: testInfo.outputPath("text-box-image.png"), fullPage: true });
});

test("margin comments keep both page edges aligned and whiteboard width persists", async ({ page }, testInfo) => {
  await openReader(page);
  const bounds = (await firstPage(page).locator(".pdf-text-layer").boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .102, bounds.y + bounds.height * .18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .275, bounds.y + bounds.height * .18, { steps: 12 });
  await page.mouse.up();
  await page.getByLabel("选中文本批注菜单").getByRole("button", { name: "高亮", exact: true }).click();
  await page.locator("button.pdf-overlay-mark.highlight").click();
  await page.getByLabel("补充批注笔记").fill("页边注释");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  const toggle = page.getByRole("button", { name: "显示页边批注", exact: true });
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  await expect(page.locator(".pdf-margin-comment")).toHaveCount(1);
  await expect.poll(async () => {
    const a = (await firstPage(page).boundingBox())!;
    const b = (await page.locator('.pdf-page-shell[data-page="2"]').boundingBox())!;
    return Math.abs(a.x - b.x) + Math.abs(a.width - b.width);
  }).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("aligned-margin-comments.png"), fullPage: true });
  await page.getByRole("button", { name: "打开 PDF 白板", exact: true }).click();
  const separator = page.getByRole("separator", { name: "调整白板宽度" });
  const initial = await page.locator(".pdf-whiteboard-pane").boundingBox();
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "340");
  const resize = (await separator.boundingBox())!;
  await page.mouse.move(resize.x + 3, resize.y + 150);
  await page.mouse.down();
  await page.mouse.move(resize.x + 53, resize.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "290");
  expect((await page.locator(".pdf-whiteboard-pane").boundingBox())!.width).toBeLessThan(initial!.width);
  await page.reload();
  await expect(separator).toHaveAttribute("aria-valuenow", "290");
});

test("freehand strokes survive reload and zoom, with cancel, undo and eraser", async ({ page }, testInfo) => {
  await openReader(page);
  await page.getByRole("button", { name: "手绘涂鸦", exact: true }).click();
  const layer = firstPage(page).getByLabel("PDF 手绘图层");
  async function draw() {
    const bounds = (await layer.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .4);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .5, { steps: 12 });
    await page.mouse.up();
  }
  await draw();
  const stroke = layer.getByLabel("手绘笔迹");
  await expect(stroke).toHaveCount(1);
  const saved = await stroke.getAttribute("d");
  await draw();
  await expect(stroke).toHaveCount(2);
  await page.getByRole("button", { name: "撤销本页最后笔迹" }).click();
  await expect(stroke).toHaveCount(1);
  await page.getByRole("button", { name: "完成手绘", exact: true }).click();
  await page.reload();
  await expect(stroke).toHaveCount(1);
  await expect(stroke).toHaveAttribute("d", saved!);
  const originalLayer = (await layer.boundingBox())!;
  await page.getByRole("button", { name: "按比例放大 PDF", exact: true }).click();
  await expect.poll(async () => (await layer.boundingBox())!.width).toBeGreaterThan(originalLayer.width);
  const scaled = (await stroke.getAttribute("d"))!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const original = saved!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(scaled).toHaveLength(original.length);
  scaled.forEach((value, index) => expect(value).toBeCloseTo(original[index], 5));
  await page.getByRole("button", { name: "手绘涂鸦", exact: true }).click();
  const bounds = (await layer.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await layer.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(stroke).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("freehand.png"), fullPage: true });
  await page.getByRole("button", { name: "橡皮擦", exact: true }).click();
  // Click directly on the midpoint of the line, not its rectangular bounding box.
  const erasedBounds = (await layer.boundingBox())!;
  await page.mouse.click(erasedBounds.x + erasedBounds.width * .3, erasedBounds.y + erasedBounds.height * .45);
  await expect(stroke).toHaveCount(0);
  await page.reload();
  await expect(stroke).toHaveCount(0);
});
