import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.setViewportSize({ width: 1600, height: 1000 });
});

test("empty center offers theme-aware vector branding, working entry points and an offline guide", async ({ page }, testInfo) => {
  // This scenario intentionally keeps an empty center after closing Settings;
  // automatic empty-panel closure is covered by emptyDockRegions/dockWorkspace.
  await page.addInitScript(() => localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.close_empty_panels": false })));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "开始使用 Liteasy", exact: true });
  await expect(welcome).toBeVisible();
  await expect(welcome.locator("img, image")).toHaveCount(0);
  const mark = welcome.getByRole("img", { name: "LiteasyClaw" });
  const lightColor = await mark.evaluate((element) => getComputedStyle(element).color);
  await welcome.screenshot({ path: testInfo.outputPath("welcome-light.png") });
  await welcome.getByRole("button", { name: /打开文献库/ }).click();
  await expect(page.getByRole("textbox", { name: "搜索文献资源" })).toBeFocused();
  await expect(page.getByRole("button", { name: "导入文件", exact: true })).toBeVisible();
  await welcome.getByRole("button", { name: /开始 AI 对话/ }).click();
  await expect(page.locator("textarea.assistant-input")).toBeFocused();
  await welcome.getByRole("button", { name: /打开设置/ }).click();
  await expect(welcome).toHaveCount(0);
  const settings = page.getByRole("region", { name: "应用设置" });
  await expect(settings.getByRole("textbox", { name: "搜索设置" })).toBeFocused();
  await settings.getByRole("textbox", { name: "搜索设置" }).fill("主题");
  await settings.getByRole("radio", { name: "深色", exact: true }).check();
  await page.getByRole("button", { name: "关闭 设置", exact: true }).click();
  await expect(welcome).toBeVisible();
  expect(await mark.evaluate((element) => getComputedStyle(element).color)).not.toBe(lightColor);
  await welcome.screenshot({ path: testInfo.outputPath("welcome-dark.png") });
  await page.setViewportSize({ width: 1050, height: 750 });
  expect(await welcome.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await welcome.screenshot({ path: testInfo.outputPath("welcome-narrow-dark.png") });
  await welcome.getByRole("button", { name: /查看使用指南/ }).click();
  const help = page.getByRole("region", { name: "帮助", exact: true });
  await help.getByRole("button", { name: "第一次使用：读完并留下第一条研究笔记", exact: true }).click();
  await expect(help.getByRole("heading", { name: "再连接 AI" })).toBeVisible();
  await expect(help.getByRole("table")).toContainText("Ctrl + Shift + L");
  expect(errors).toEqual([]);
});

test("shortcuts reopen moved tools, preserve drafts and support keyboard quick actions", async ({ page }) => {
  await page.goto("/");
  const composer = page.locator("textarea.assistant-input");
  await composer.fill("这是一条尚未发送的草稿");
  await page.getByRole("button", { name: "关闭 Liteasy Chat", exact: true }).click();
  await page.keyboard.press("Control+Alt+i");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("这是一条尚未发送的草稿");
  await page.getByRole("tab", { name: "Liteasy Chat", exact: true }).press("Alt+Shift+ArrowDown");
  await page.keyboard.press("Control+Alt+i");
  await expect(page.locator(".dock-region-bottom").getByRole("tab", { name: "Liteasy Chat", exact: true })).toBeVisible();
  await expect(composer).toBeFocused();
  await page.keyboard.press("Control+Shift+l");
  await expect(page.getByRole("textbox", { name: "搜索文献资源" })).toBeFocused();
  await page.keyboard.press("Control+Shift+p");
  const commands = page.getByRole("dialog", { name: "快捷操作", exact: true });
  await expect(commands).toBeVisible();
  await commands.getByRole("textbox", { name: "搜索快捷操作" }).fill("设置");
  await page.keyboard.press("ArrowDown");
  await expect(commands.getByRole("button", { name: /打开设置/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(commands).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toBeFocused();
  await page.keyboard.press("F1");
  await expect(page.getByRole("region", { name: "帮助", exact: true })).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toBeFocused();
  await page.keyboard.press("Control+Shift+p");
  await expect(commands).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(commands).toHaveCount(0);
});

test("task presets retain pages and a chat draft and restore custom panel visibility", async ({ page }) => {
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "开始使用 Liteasy", exact: true });
  await expect(welcome).toBeVisible();
  const chat = page.locator("textarea.assistant-input");
  await chat.fill("保留这份草稿");
  await welcome.getByRole("button", { name: "阅读布局", exact: true }).click();
  await expect(chat).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索文献资源" })).not.toBeVisible();
  await welcome.getByRole("button", { name: "恢复自定义布局", exact: true }).click();
  await expect(chat).toBeVisible();
  await expect(chat).toHaveValue("保留这份草稿");
  await welcome.getByRole("button", { name: "处理布局", exact: true }).click();
  await expect(page.getByRole("tab", { name: "运行记录", exact: true })).toBeVisible();
  await expect(chat).toHaveValue("保留这份草稿");
});
