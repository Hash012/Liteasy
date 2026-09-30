import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("AI guide uses real PDF geometry, persists, and shares clickable dashed explanations with reading mode", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const prompts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.route("**/literature-guide-model", async (route) => {
    const request = route.request().postDataJSON(); prompts.push(request.prompt);
    expect(request.requireLive).toBe(true);
    expect(request.outputFormat.name).toBe("liteasy_literature_guide");
    await route.fulfill({ json: { answer: JSON.stringify({ level: "balanced", items: [
      { page: 1, quote: "WiWi tail", category: "insight", title: "字形与间距", explanation: "字形的实际边界与字距不同，定位时需要同时考虑两者。" }
    ] }), execution: { mode: "live", provider: "openai" } } });
  });
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/?pdf-highlight-fixture#literature-guide");
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).toContainText("WiWi", { timeout: 30_000 });
  const controls = page.getByRole("group", { name: "文献 AI 标注" });
  await controls.getByRole("button", { name: "AI 标注", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 标注", exact: true });
  await dialog.getByRole("button", { name: "讲解重点", exact: false }).click();
  await dialog.getByLabel("自定义系统提示词").fill("请关注字形定位的误差来源。");
  await page.screenshot({ path: testInfo.outputPath("literature-guide-options.png"), fullPage: true });
  await dialog.getByRole("button", { name: "开始标注", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("已标注 1 处");
  await dialog.getByRole("button", { name: "返回阅读" }).click();
  const mark = page.locator("button.pdf-overlay-mark.ai-guide").first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveCSS("border-bottom-style", "dashed");
  expect(prompts[0]).toContain('"mode":"auto"');
  expect(prompts[0]).toContain('请关注字形定位的误差来源。');
  expect(prompts[0]).toContain('"level":"balanced"');
  await mark.click();
  await expect(page.getByRole("complementary", { name: "AI 讲解：WiWi tail", exact: true })).toContainText("字形的实际边界与字距不同");
  await page.getByRole("button", { name: "关闭注释编辑器" }).click();
  await controls.getByRole("button", { name: "AI 标注", exact: false }).click();
  await dialog.getByRole("button", { name: "隐藏 AI 标注" }).click();
  await expect(mark).toHaveCount(0);
  await dialog.getByRole("button", { name: "显示 AI 标注" }).click();
  await dialog.getByRole("button", { name: "返回阅读" }).click();
  await page.reload();
  await expect(mark).toBeVisible({ timeout: 30_000 });
  expect(prompts).toHaveLength(1);
  await controls.getByRole("button", { name: "AI 标注", exact: false }).click();
  await dialog.getByLabel("AI 标注模式").selectOption("advanced");
  await dialog.getByRole("button", { name: "开始标注" }).click();
  await expect(dialog.getByRole("status")).toContainText("已标注 1 处");
  await dialog.getByRole("button", { name: "返回阅读" }).click();
  expect(prompts[1]).toContain('"mode":"advanced"');

  const text = await page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer').innerText();
  await page.route("https://guide-parser.example.test/v1/pdf/mineru-extract", (route) => route.fulfill({ json: {
    pages: [{ page: 1, text }], markdown: `# 阅读测试\n\n${text}`, figures: []
  } }));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("region", { name: "应用设置" }).getByRole("button", { name: "论文与推荐" }).click();
  await page.getByLabel("论文内容解析").selectOption("custom");
  await page.getByLabel("MinerU API 地址").fill("https://guide-parser.example.test");
  await page.getByLabel("mineru API key", { exact: true }).fill("guide-test-key");
  await page.getByRole("button", { name: "保存密钥", exact: true }).last().click();
  await page.getByRole("button", { name: "关闭 设置", exact: true }).click();
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  await page.getByRole("button", { name: "MinerU 解析", exact: true }).click();
  await page.getByRole("button", { name: "阅读模式", exact: true }).click();
  const reading = page.getByRole("region", { name: "论文阅读模式", exact: true });
  await expect(reading.getByRole("group", { name: "文献 AI 标注" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...CSS.highlights.entries()].filter(([name]) => name.includes("guide")).reduce((sum, [, marks]) => sum + marks.size, 0))).toBeGreaterThan(0);
  const point = await page.evaluate(() => {
    const mark = [...CSS.highlights.entries()].find(([name, marks]) => name.includes("guide") && marks.size)!;
    const rect = ([...mark[1]][0] as Range).getBoundingClientRect();
    return { x: rect.left + 4, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  const explanation = reading.getByRole("complementary", { name: "AI 讲解", exact: true });
  await expect(explanation).toContainText("字形的实际边界与字距不同");
  await page.screenshot({ path: testInfo.outputPath("literature-guide-reading.png"), fullPage: true });
  await explanation.getByRole("button", { name: "关闭 AI 讲解" }).click();
  const comments = reading.getByRole("complementary", { name: "阅读模式批注" });
  await comments.getByRole("button", { name: "编辑", exact: true }).click();
  await comments.getByRole("textbox", { name: "阅读批注内容" }).fill("我补充的讲解");
  await comments.getByRole("button", { name: "保存批注", exact: true }).click();
  await expect(comments.getByRole("status")).toContainText("批注已保存");
  await comments.getByRole("button", { name: "查看 PDF", exact: true }).click();
  await mark.click();
  await expect(page.getByRole("complementary", { name: "AI 讲解：WiWi tail", exact: true })).toContainText("我补充的讲解");
  await page.getByRole("button", { name: "关闭注释编辑器" }).click();
  await controls.getByRole("button", { name: "AI 标注", exact: false }).click();
  await dialog.getByRole("button", { name: "删除 AI 标注" }).click();
  await dialog.getByRole("button", { name: "返回阅读" }).click();
  await expect(mark).toBeVisible(); // User-edited explanations are protected.
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).toContainText("WiWi", { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath("literature-guide-pdf.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("later-page guides cover the complete mixed-font quote without depending on offscreen DOM measurements", async ({ page }) => {
  test.setTimeout(90_000);
  const { guideGeometryPdf, guideGeometryQuote } = await import("../fixtures/guideGeometryPdf");
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: guideGeometryPdf(), contentType: "application/pdf" }));
  await page.route("**/literature-guide-model", (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { answer: JSON.stringify({ level: "balanced", items: request.prompt.includes('"page":4') ? [
      { page: 4, quote: guideGeometryQuote, category: "reasoning", title: "一致性", explanation: "读取已提交版本，使不同读取获得一致的数据。" }
    ] : [] }), execution: { mode: "live", provider: "openai" } } });
  });
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/?pdf-highlight-fixture#literature-guide");
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).toContainText("Page one", { timeout: 30_000 });
  // Reproduce bad offscreen font metrics while leaving visible text unaffected.
  await page.addStyleTag({ content: "body > .pdf-text-layer span { transform: scaleX(.12) !important; }" });
  const controls = page.getByRole("group", { name: "文献 AI 标注" });
  await controls.getByRole("button", { name: "AI 标注", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 标注", exact: true });
  await dialog.getByRole("button", { name: "开始标注" }).click();
  await expect(dialog.getByRole("status")).toContainText("已标注 1 处 · 4/4 页");
  await dialog.getByRole("button", { name: "返回阅读" }).click();
  const marks = page.locator('.pdf-page-shell[data-page="4"] .pdf-overlay-mark.ai-guide');
  await expect(marks).toHaveCount(4);
  const geometry = await marks.evaluateAll((elements) => elements.map((element) => ({
    left: parseFloat((element as HTMLElement).style.left), width: parseFloat((element as HTMLElement).style.width), top: parseFloat((element as HTMLElement).style.top)
  })));
  for (const [index, rect] of geometry.entries()) {
    expect(rect.left).toBeCloseTo(10, 1);
    expect(rect.width).toBeGreaterThan(25);
    if (index) expect(rect.top - geometry[index - 1].top).toBeCloseTo(5, 1);
  }
  await marks.first().scrollIntoViewIfNeeded();
  await expect(page.locator('.pdf-page-shell[data-page="4"] .pdf-text-layer')).toContainText("visible record");
  await expect(marks).toHaveCount(4);
  const patched = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("liteasy.pdf-annotations/v1:"));
    if (!key) return false;
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved[0].rects = [{ ...saved[0].rects[0], width: 3 }];
    saved[0].note = "用户补充的解释"; saved[0].revision = 2;
    localStorage.setItem(key, JSON.stringify(saved));
    return true;
  });
  expect(patched).toBe(true);
  await page.reload();
  await expect(page.locator('.pdf-page-shell[data-page="4"]')).toBeAttached({ timeout: 30_000 });
  await page.getByLabel("当前页码").fill("4");
  await page.getByLabel("当前页码").press("Enter");
  await expect(page.locator('.pdf-page-shell[data-page="4"] .pdf-text-layer')).toContainText("visible record");
  await expect(marks).toHaveCount(4);
  await marks.first().click();
  await expect(page.getByRole("complementary", { name: `AI 讲解：${guideGeometryQuote}`, exact: true })).toContainText("用户补充的解释");
});
