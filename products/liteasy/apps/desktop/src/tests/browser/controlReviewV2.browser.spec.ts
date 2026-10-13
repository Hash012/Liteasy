import { expect, test } from "@playwright/test";
const fixture = "/src/tests/browser/fixtures/control-review-v2.html";
test("Escape dismisses a nested picker, filter and owner one layer at a time", async ({ page }) => {
  await page.goto(fixture);
  const owner = page.getByRole("region", { name: "嵌套关闭测试" });
  await owner.focus();
  const info = page.getByRole("button", { name: "嵌套说明", exact: true });
  await info.click();
  await expect(page.getByRole("group", { name: "嵌套说明", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "嵌套说明", exact: true })).toHaveCount(0);
  await expect(info).toBeFocused();
  const filter = page.getByRole("button", { name: "嵌套筛选", exact: true });
  await filter.click();
  const picker = page.getByRole("combobox", { name: "嵌套类型" });
  await picker.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "嵌套筛选", exact: true })).toBeVisible();
  await expect(picker).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "嵌套筛选", exact: true })).toHaveCount(0);
  await expect(filter).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByText("外层已关闭", { exact: true })).toBeVisible();
});
test("pane budgets protect active tabs, sibling drafts and keyboard navigation", async ({ page }, info) => {
  await page.goto(fixture);
  for (const count of [2, 6, 15]) {
    await page.getByRole("combobox", { name: "标签数量" }).click(); await page.getByRole("option", { name: String(count), exact: true }).click();
    for (const width of [280, 420, 640, 1000]) {
      await page.locator("main").evaluate((el, w) => el.style.setProperty("--test-pane-width", `${w}px`), width);
      const selected = page.getByRole("tab", { selected: true }); await expect(selected).toBeInViewport();
      const title = page.getByRole("table", { name: "文献与文件列表" }).getByText("合成论文", { exact: true });
      await expect(title).toBeVisible();
      expect(await title.evaluate(el => el.clientWidth > 0 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect.poll(() => page.locator(".dock-tab-strip").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const input = page.getByRole("textbox", { name: `文档草稿${count - 1}` }); await input.fill("跨宽度保留");
      await selected.focus(); await page.keyboard.press("ArrowLeft"); await expect(page.getByRole("tab", { selected: true })).toBeFocused();
      await page.keyboard.press("End"); await expect(input).toHaveValue("跨宽度保留");
      await page.screenshot({ path: info.outputPath(`tabs-${count}-${width}.png`), fullPage: true });
    }
  }
});
test("nested owners, portal focus, required submission, section drafts and local errors", async ({ page }, info) => {
  await page.goto(fixture);
  await page.mouse.move(1100, 100); await page.screenshot({ path: info.outputPath("idle.png"), fullPage: true });
  const first = page.getByTestId("内层一"), second = page.getByTestId("内层二");
  await first.hover(); await expect(first.getByRole("group")).toHaveCSS("opacity", "1"); await expect(second.getByRole("group")).toHaveCSS("opacity", "0");
  const trigger = first.getByRole("button"); await trigger.focus(); await page.keyboard.press("Enter"); await page.getByRole("menuitem", { name: "查看内层一" }).hover(); await expect(first.getByRole("group")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await page.screenshot({ path: info.outputPath("keyboard.png"), fullPage: true });
  await page.getByRole("button", { name: "保存选项" }).click(); await expect(page.getByRole("alert")).toHaveText("请选择一个选项。");
  await page.getByRole("combobox", { name: "状态", exact: true }).click(); await page.getByRole("option", { name: /^禁用/ }).click(); await page.getByRole("button", { name: "保存选项" }).click(); await expect(page.locator("output")).toHaveText("disabled");
  const section = page.getByRole("button", { name: "章节设置" }); await section.click(); await page.getByRole("textbox", { name: "章节草稿" }).fill("保留章节草稿"); await section.click(); await section.click(); await expect(page.getByRole("textbox", { name: "章节草稿" })).toHaveValue("保留章节草稿");
  await page.getByRole("button", { name: "文件筛选" }).click(); await page.getByRole("combobox", { name: "筛选文件格式" }).click(); await page.getByRole("option", { name: "EPUB", exact: true }).click(); await page.keyboard.press("Escape"); await expect(page.getByText("合成电子书", { exact: true })).toBeVisible(); await expect(page.getByText("合成论文", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("expanded.png"), fullPage: true });
  await page.getByRole("button", { name: "注入异常" }).click(); await expect(page.getByRole("alert")).toContainText("此面板暂时无法显示"); await expect(page.getByRole("textbox", { name: "章节草稿" })).toHaveValue("保留章节草稿"); await page.screenshot({ path: info.outputPath("error.png"), fullPage: true });
});
test("font scale, themes, forced colors and coarse pointer preserve value controls", async ({ browser }, info) => {
  // Each capture owns its emulation context: Chromium screenshots may reset pointer emulation.
  for (const theme of ["浅色", "深色"]) for (const ratio of [1, 1.25, 1.5]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, hasTouch: true, reducedMotion: "reduce" });
    const page = await context.newPage(); await page.goto(fixture);
    await page.getByRole("button", { name: theme, exact: true }).tap();
    await page.locator("html").evaluate((el, r) => el.style.setProperty("--app-font-ratio", String(r)), ratio);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expect.poll(async () => (await page.getByRole("combobox", { name: "状态", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`touch-${theme}-${ratio}.png`), fullPage: true });
    await context.close();
  }
  const context = await browser.newContext({ forcedColors: "active" }); const page = await context.newPage();
  await page.goto(fixture); await page.getByRole("combobox", { name: "状态", exact: true }).waitFor();
  await page.screenshot({ path: info.outputPath("forced-colors.png"), fullPage: true }); await context.close();
});
