import { expect, test } from "@playwright/test";

test("commands, compact resizable annotations, context drag, and persistent quick ask", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  page.on("pageerror", (error) => console.error(error.stack));
  const content = "BT /F1 24 Tf 3 Tc 50 240 Td (WiWi tail) Tj ET\nBT /F1 12 Tf 0 Tc 50 190 Td (Abstract: Compact representations retain relevant information.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdf = Buffer.from(source);
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/?pdf-highlight-fixture#ui-improvements");
  const text = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer');
  await expect(text).toContainText("Abstract", { timeout: 30_000 });
  const composer = page.getByPlaceholder("输入你的问题或命令");
  await composer.fill("/");
  await composer.press("Enter");
  await expect(page.locator(".assistant-command-chip")).toHaveText("/生成薄读");
  await expect(page.getByLabel("输入候选")).toHaveCount(0);
  const chip = page.locator(".assistant-command-chip");
  await expect(chip).toHaveCSS("border-radius", "5px");

  const resizer = page.getByRole("separator", { name: "调整批注栏宽度" });
  const resizeBox = (await resizer.boundingBox())!;
  await page.mouse.move(resizeBox.x + 2, resizeBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 102, resizeBox.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute("aria-valuenow", "280");

  async function selectWord() {
    await text.scrollIntoViewIfNeeded();
    const box = (await page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer').boundingBox())!;
    await page.mouse.move(box.x + 50.5 / 400 * box.width, box.y + 42 / 300 * box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + 112.5 / 400 * box.width, box.y + 42 / 300 * box.height, { steps: 10 });
    await page.mouse.up();
  }
  await selectWord();
  await page.getByLabel("选中文本批注菜单").getByRole("button", { name: "高亮", exact: true }).click();
  const mark = page.locator("button.pdf-overlay-mark.highlight");
  await expect(mark).toHaveCount(1);
  const summary = page.getByRole("button", { name: /^编辑批注：/ });
  await expect(summary).toHaveCSS("-webkit-line-clamp", "3");
  await expect(page.getByRole("checkbox", { name: /将第 1 页高亮批注公开到论坛/ })).toHaveCount(0);
  await mark.dragTo(composer);
  await expect(page.getByRole("button", { name: "移除上下文：das24a.pdf" })).toBeVisible();
  await expect(page.getByText("已将选中文段添加到对话。", { exact: true })).toHaveCount(0);
  await mark.click();
  await expect(page.getByText("输入后将在这里实时显示排版效果。")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭注释编辑器" }).click();
  await summary.click();
  await page.getByRole("button", { name: "删除", exact: true }).click();

  await selectWord();
  await page.getByLabel("选中文本批注菜单").getByRole("button", { name: "速问", exact: true }).click();
  await page.getByLabel("速问问题").fill("什么是紧凑表示？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const quickMark = page.locator("button.pdf-overlay-mark.quick-ask");
  await expect(quickMark).toHaveCount(1);
  await expect(quickMark).toHaveCSS("border-bottom-style", "dashed");
  await expect(page.locator(".pdf-annotation-popover")).toContainText("减少存储与计算开销");
  await page.reload();
  await expect(resizer).toHaveAttribute("aria-valuenow", "280");
  await expect(quickMark).toHaveCount(1);
  await quickMark.click();
  await expect(page.locator(".pdf-annotation-popover")).toContainText("什么是紧凑表示？");
  await expect(page.locator(".pdf-annotation-popover")).toContainText("减少存储与计算开销");
  await page.screenshot({ path: testInfo.outputPath("ui-improvements.png"), fullPage: true });
});
