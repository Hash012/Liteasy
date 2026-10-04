import { expect, test } from "@playwright/test";

const document = `# 研究笔记 · Research notes

清晰的排版帮助我们专注内容。这是一段 **重点结论**、*补充说明* 和 \`inline code\`，以及 [参考资料](https://example.com)。

## 从问题到证据

> 先提出问题，再核对证据。引用应当融入正文，保持清晰而安静的视觉层次。
>
> 第二段引用也要保留合理间距。

1. 确认研究问题
   - 查看原始资料
   - 对照实验结论
2. 整理下一步行动

- [x] 阅读原文
- [ ] 补充实验

### 实验记录

| 方法 | 样本数 | 结论 |
| :--- | ---: | :--- |
| Baseline | 128 | 保持稳定 |
| Improved | 256 | 有所提升 |

\`\`\`ts
const result = { title: "Research", score: 0.95 };
console.log(result);
\`\`\`

## 公式与插图

行内公式 $E = mc^2$；块级公式：

$$
P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}
$$

![研究流程](https://markdown.test/figure.svg "从文献到笔记")

---

长代码保持单独滚动，不撑破文档：

\`\`\`text
${"research-data/".repeat(80)}
\`\`\`
`;

test("shared Markdown stays readable in light, dark and narrow readers and respects font scaling", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1120 });
  await page.emulateMedia({ colorScheme: "light" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("https://markdown.test/figure.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" rx="6" fill="#e8f1fa"/><text x="26" y="58" fill="#244b72" font-family="sans-serif" font-size="22">Paper → Evidence → Research notes</text></svg>' }));
  await page.addInitScript((text) => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.markdown_mode": "manual", "view.reader_font_family": "Arial, sans-serif" }));
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Typography", { create: true });
      const writer = await (await directory.getFileHandle("Research.md", { create: true })).createWritable();
      await writer.write(text); await writer.close(); return directory;
    } });
  }, document);
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  await notes.getByRole("treeitem", { name: "extern/Typography", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 Research.md", exact: true }).dblclick();
  const workspace = page.getByRole("region", { name: "Markdown 文件阅读与编辑" });
  const content = workspace.locator(".markdown-content");
  const title = content.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("研究笔记 · Research notes");
  await expect(title).toHaveCSS("margin-top", "0px");
  await expect(title).toHaveCSS("font-size", "32px");
  const chapters = workspace.getByRole("combobox", { name: "Markdown 章节" });
  await chapters.selectOption({ label: "公式与插图" });
  await expect(content.locator(".katex-display")).toBeVisible();
  await expect(content.getByRole("img", { name: "研究流程" })).toBeVisible();
  await chapters.selectOption({ label: "从问题到证据" });
  await expect(content.getByRole("cell", { name: "256" })).toHaveCSS("text-align", "right");
  await content.getByRole("button", { name: "复制代码", exact: true }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const result = { title: "Research", score: 0.95 };\nconsole.log(result);');
  await workspace.screenshot({ path: testInfo.outputPath("markdown-light.png"), animations: "disabled" });
  const lightCode = await content.locator("pre").first().evaluate((element) => getComputedStyle(element).color);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await expect.poll(() => content.locator("pre").first().evaluate((element) => getComputedStyle(element).color)).not.toBe(lightCode);
  await workspace.screenshot({ path: testInfo.outputPath("markdown-dark.png"), animations: "disabled" });
  await workspace.getByRole("button", { name: "调整 Markdown 字号" }).click();
  const font = page.getByRole("slider", { name: "Markdown 字号" });
  await font.focus(); await font.press("Home"); await font.press("ArrowRight"); await font.press("ArrowRight"); await font.press("ArrowRight"); await font.press("ArrowRight");
  await font.press("ArrowRight"); await font.press("ArrowRight"); await font.press("ArrowRight"); await font.press("ArrowRight");
  await page.keyboard.press("Escape");
  await chapters.selectOption({ label: "研究笔记 · Research notes" });
  await expect(title).toHaveCSS("font-size", "40px");
  await chapters.selectOption({ label: "公式与插图" });
  // Simulate a resized dock without depending on its persisted layout.
  await workspace.evaluate((element) => { element.style.width = "380px"; });
  expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const longCode = content.locator("pre").last();
  await longCode.scrollIntoViewIfNeeded();
  expect(await longCode.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await longCode.focus(); await longCode.press("ArrowRight");
  await expect.poll(() => longCode.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
