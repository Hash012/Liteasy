import { expect, test } from "@playwright/test";

test("centrally saves a generation prompt and restores it after reload with the editor collapsed", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  async function openPromptSettings() {
    await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "应用设置" });
    await settings.getByRole("button", { name: "AI 与助手" }).click();
    return settings.getByRole("region", { name: "AI 生成提示词", exact: true });
  }
  let panel = await openPromptSettings();
  await panel.getByRole("combobox", { name: "提示词用途" }).selectOption("thin_reading");
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await panel.getByRole("combobox", { name: "生成风格" }).selectOption("question");
  await panel.getByRole("button", { name: "自定义系统提示词" }).click();
  await expect(panel.getByRole("textbox")).toHaveValue(/以启发式问题引导理解/);
  await panel.getByRole("textbox").fill("优先解释隐含假设，给出三个检查理解的问题。");
  await page.reload();
  panel = await openPromptSettings();
  await panel.getByRole("combobox", { name: "提示词用途" }).selectOption("thin_reading");
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await panel.getByRole("button", { name: "自定义系统提示词" }).click();
  await expect(panel.getByRole("textbox")).toHaveValue("优先解释隐含假设，给出三个检查理解的问题。");
  await panel.getByRole("combobox", { name: "生成风格" }).selectOption("default");
  await expect(panel.getByRole("textbox")).toHaveValue(/你是论文薄读讲解者/);
});

test("settings opens centrally, searches globally and retains drafts across categories in both themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "应用设置" });
  await expect(page.locator('[data-region="main"] .settings-page')).toBeVisible();
  await expect(page.locator('[data-region="left"]').getByRole("region", { name: "本地文献库" })).toBeVisible();
  await settings.getByRole("button", { name: "AI 与助手" }).click();
  await settings.getByLabel("AI 接入方式").selectOption("direct");
  await settings.getByLabel("模型 ID", { exact: true }).fill("unsaved-model");
  await settings.getByLabel("API key", { exact: true }).fill("unsaved-browser-test-key");
  const docs = settings.getByRole("link", { name: "查看服务商 API 文档" });
  await expect(docs).toHaveAttribute("target", "_blank");
  await expect(docs).toHaveAttribute("rel", "noopener noreferrer");
  const linkBox = (await docs.boundingBox())!;
  expect(linkBox.width).toBeLessThan(220);
  expect(linkBox.height).toBeLessThan(36);
  await settings.screenshot({ path: testInfo.outputPath("settings-models-light.png") });
  await settings.getByRole("button", { name: "文件与存储" }).click();
  await settings.getByRole("textbox", { name: "搜索设置" }).fill("PDF OCR");
  await expect(settings.getByLabel("扫描 PDF OCR 语言")).toBeVisible();
  await expect(settings.getByRole("status")).toContainText("找到 1 个设置分组");
  await settings.getByRole("button", { name: "AI 与助手" }).click();
  await expect(settings.getByLabel("模型 ID", { exact: true })).toHaveValue("unsaved-model");
  await expect(settings.getByLabel("API key", { exact: true })).toHaveValue("unsaved-browser-test-key");
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  await settings.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(settings).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await settings.screenshot({ path: testInfo.outputPath("settings-appearance-dark.png") });
  await page.setViewportSize({ width: 1000, height: 800 });
  await settings.getByRole("button", { name: "AI 与助手" }).click();
  await expect(settings.getByLabel("API 服务商")).toBeVisible();
  expect(await settings.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await settings.screenshot({ path: testInfo.outputPath("settings-models-narrow-dark.png") });
});
