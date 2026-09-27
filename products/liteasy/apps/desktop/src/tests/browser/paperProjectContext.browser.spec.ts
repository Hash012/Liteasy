import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("discovers a paper project, creates a note and combines source and derived assets in the draft", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).not.toBeEmpty({ timeout: 30_000 });
  // The browser has no Tauri fulltext store. Exercise the normal extraction path
  // using the fixture PDF's actual rendered text as the parser response.
  const extractedText = await page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer').innerText();
  const figure = await page.locator('.pdf-page-shell[data-page="1"] canvas').first().screenshot();
  const figureDataUrl = `data:image/png;base64,${figure.toString("base64")}`;
  await page.route("https://project-parser.example.test/v1/pdf/mineru-extract", async (route) => {
    await route.fulfill({ json: { pages: [{ page: 1, text: extractedText }], markdown: extractedText,
      figures: [{ id: "preview-figure", page: 1, alt: "论文页面图片", dataUrl: figureDataUrl, sourcePath: "page-1.png" }] } });
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("论文内容解析").selectOption("custom");
  await page.getByLabel("MinerU API 地址").fill("https://project-parser.example.test");
  await page.getByLabel("mineru API key", { exact: true }).fill("browser-project-key");
  await page.getByRole("button", { name: "保存密钥", exact: true }).last().click();
  await expect(page.getByText("密钥已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "MinerU 解析", exact: true }).click();
  await expect(page.getByRole("button", { name: "阅读模式", exact: true })).toBeVisible();
  const draft = page.getByPlaceholder("输入你的问题或命令");
  await draft.fill("请根据论文原文和我的研究笔记梳理问题");
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "上下文资产浏览器" });
  const filters = browser.getByRole("navigation", { name: "上下文资产筛选" });
  await expect(filters.getByRole("button", { name: /项目\s*1/ })).toBeVisible();
  await filters.getByRole("button", { name: /项目\s*1/ }).click();
  await browser.getByRole("button", { name: "预览 das24a.pdf", exact: true }).click();
  const preview = browser.getByRole("complementary", { name: "资产预览" });
  await expect(preview.getByRole("textbox", { name: "新建项目笔记" })).toBeVisible();
  await preview.getByRole("textbox", { name: "新建项目笔记" }).fill("研究笔记：核对文字边界与论文中的原始证据。");
  await preview.getByRole("button", { name: "保存并加入上下文", exact: true }).click();
  await expect(browser.getByRole("status")).toHaveText("已保存项目笔记并加入上下文。");
  await filters.getByRole("button", { name: "全部类别", exact: false }).click();
  await expect(browser.getByRole("checkbox", { name: "选择 项目笔记", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: /原文\s*\d+/ })).toBeVisible({ timeout: 30_000 });
  await filters.getByRole("button", { name: /原文\s*\d+/ }).click();
  const source = browser.getByRole("checkbox", { name: /选择 das24a.pdf · 第 1 页/ });
  await source.check();
  await expect(preview).toContainText("原始内容 · 只读");
  await expect(preview.locator(".context-asset-preview-text")).toContainText(extractedText.trim().slice(0, 30));
  await preview.getByRole("button", { name: "创建可编辑副本", exact: true }).click();
  await expect(browser.getByRole("status")).toHaveText("已创建可编辑副本并加入上下文，原始内容保持不变。");
  await filters.getByRole("button", { name: /图片\s*1/ }).click();
  await browser.getByRole("button", { name: "预览 论文页面图片", exact: true }).click();
  const image = preview.getByRole("img", { name: "论文页面图片", exact: true });
  await expect(image).toHaveAttribute("src", figureDataUrl);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("image-context-preview.png"), fullPage: true, animations: "disabled" });
  await filters.getByRole("button", { name: /笔记\s*\d+/ }).click();
  await browser.getByRole("checkbox", { name: "选择 项目笔记", exact: true }).check();
  await expect(browser.getByText("已选 2 项", { exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "全部类别", exact: false }).click();
  await page.screenshot({ path: testInfo.outputPath("project-context-browser.png"), fullPage: true, animations: "disabled" });
  if (process.env.LITEASY_PROJECT_CONTEXT_SCREENSHOT) {
    await page.screenshot({ path: process.env.LITEASY_PROJECT_CONTEXT_SCREENSHOT, fullPage: true, animations: "disabled" });
  }
  await browser.getByRole("button", { name: "添加所选（2）", exact: true }).click();
  await expect(browser.getByRole("status")).toContainText("已添加 2 项上下文");
  await browser.getByRole("button", { name: "返回对话", exact: true }).last().click();
  await expect(browser).not.toBeVisible();
  await expect(draft).toHaveValue("请根据论文原文和我的研究笔记梳理问题");
  const tokens = page.getByLabel("已添加到对话上下文", { exact: true });
  await expect(tokens.getByRole("button", { name: "移除上下文：项目笔记", exact: true })).toBeVisible();
  await expect(tokens.getByRole("button", { name: "移除上下文：das24a.pdf · 第 1 页", exact: true })).toBeVisible();
  await expect(tokens.getByRole("button", { name: /移除上下文：.*副本/ })).toBeVisible();
  await draft.fill("请解释 @界面字号");
  await page.getByRole("button", { name: "预览当前候选", exact: true }).click();
  await expect(preview.locator(".context-asset-preview-text")).toContainText("界面字号：14");
  await expect(preview.locator(".context-asset-preview-text")).toContainText("生效时间：即时");
  await expect(browser.getByText("已选 0 项", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("setting-context-preview.png"), fullPage: true, animations: "disabled" });
  await browser.getByRole("button", { name: "返回对话", exact: true }).last().click();
  await expect(draft).toHaveValue("请解释 ");
  expect(errors).toEqual([]);
});
