import { expect, test } from "@playwright/test";
const fixture = "/src/tests/browser/fixtures/reader-settings-v2.html";
for (const width of [320, 400, 520]) test(`settings and reader controls fit ${width}px with keyboard and twofold text`, async ({ page }, info) => {
  await page.setViewportSize({ width: width + 24, height: 1000 });
  await page.goto(fixture);
  await page.evaluate((width) => document.documentElement.style.setProperty("--test-pane-width", `${width}px`), width);
  const dictionary = page.getByRole("combobox", { name: "词典服务", exact: true });
  await expect(dictionary).toHaveText("必应词典");
  await dictionary.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: /^有道词典/ })).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(dictionary).toHaveText("有道词典");
  await page.getByRole("button", { name: "配置可选密钥" }).click();
  await page.getByLabel("翻译服务密钥", { exact: true }).fill("synthetic-preview-draft");
  await page.getByRole("button", { name: "配置可选密钥" }).click();
  await page.getByRole("button", { name: "配置可选密钥" }).click();
  await expect(page.getByLabel("翻译服务密钥", { exact: true })).toHaveValue("synthetic-preview-draft");
  await page.getByRole("button", { name: "配置可选密钥" }).click();
  const chapter = page.getByRole("treeitem", { name: "第一章：研究背景与可复现性 Research background", exact: true });
  await chapter.focus(); await page.keyboard.press("ArrowLeft"); await expect(chapter).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(page.getByText("当前页 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "PDF 阅读配色", exact: true }).click();
  await page.getByRole("combobox", { name: "PDF 页面配色", exact: true }).click();
  await page.getByRole("option", { name: "自定义", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "自定义 PDF 页面颜色", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.evaluate(() => {
    const provider = document.querySelector<HTMLElement>(".fui-FluentProvider")!;
    provider.style.setProperty("--fontSizeBase300", "28px");
    provider.style.setProperty("--lineHeightBase300", "40px");
    provider.style.setProperty("--fontSizeBase200", "24px");
  });
  const settings = page.getByTestId("review-settings");
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(dictionary).toHaveText("有道词典");
  const outlineRows = await page.locator(".pdf-outline .fui-TreeItemLayout").evaluateAll(elements => elements.map(element => {
    const title = element.querySelector<HTMLElement>(".pdf-outline-title")!;
    const style = getComputedStyle(title), row = element.getBoundingClientRect(), text = title.getBoundingClientRect();
    return { lineHeight: Number.parseFloat(style.lineHeight), fontSize: Number.parseFloat(style.fontSize), top: row.top, bottom: row.bottom, textTop: text.top, textBottom: text.bottom };
  }));
  for (let index = 0; index < outlineRows.length; index++) {
    const row = outlineRows[index];
    expect(row.lineHeight).toBeGreaterThanOrEqual(row.fontSize * 1.4);
    expect(row.textTop).toBeGreaterThanOrEqual(row.top);
    expect(row.textBottom).toBeLessThanOrEqual(row.bottom);
    if (index) expect(row.top).toBeGreaterThanOrEqual(outlineRows[index - 1].bottom);
  }
  await page.screenshot({ path: info.outputPath(`reader-settings-${width}-dark-200.png`), fullPage: true, animations: "disabled" });
});
