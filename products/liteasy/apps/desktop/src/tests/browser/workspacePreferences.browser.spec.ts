import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
});

test("the last page closes its panel and the preference can keep empty panels open", async ({ page }) => {
  await page.goto("/");
  const right = page.locator('[data-region="right"]');
  await right.getByRole("button", { name: "关闭 Liteasy Chat", exact: true }).click();
  await expect(right).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(right.getByRole("tab", { name: "Liteasy Chat", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "应用设置" });
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  const setting = settings.getByRole("switch", { name: "自动收起空面板" });
  await expect(setting).toBeChecked(); await setting.uncheck();
  await right.getByRole("button", { name: "关闭 Liteasy Chat", exact: true }).click();
  await expect(right).toBeVisible(); await expect(right.getByRole("tab")).toHaveCount(0);
  await page.reload();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  await expect(setting).not.toBeChecked();
});

test("interface fonts reach Fluent controls and reader fonts reach Markdown text", async ({ page }) => {
  await page.goto("/");
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  await library.getByLabel("选择文献库文件").setInputFiles({ name: "fonts.md", mimeType: "text/markdown", buffer: Buffer.from("# Typography\n\nReader text.") });
  await library.getByRole("button", { name: "选择文件 Typography", exact: true }).dblclick();
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "应用设置" });
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  await settings.getByRole("combobox", { name: "界面英文字体", exact: true }).fill("Courier New");
  await settings.getByRole("combobox", { name: "界面英文字体", exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: "Courier New", exact: true }).click();
  await expect(settings.getByRole("button", { name: "外观与阅读" })).toHaveCSS("font-family", /Liteasy-ui-en-0/);
  await settings.getByRole("combobox", { name: "界面中文字体", exact: true }).click();
  await page.getByRole("option", { name: "思源黑体", exact: true }).click();
  await expect(settings.getByRole("button", { name: "外观与阅读" })).toHaveCSS("font-family", /Liteasy-ui-zh-0/);
  await settings.getByRole("combobox", { name: "阅读中文字体", exact: true }).click();
  await page.getByRole("option", { name: "宋体", exact: true }).click();
  await settings.getByRole("combobox", { name: "阅读英文字体", exact: true }).fill("Cambria");
  await settings.getByRole("combobox", { name: "阅读英文字体", exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: "Cambria", exact: true }).click();
  await page.locator('[data-region="main"]').getByRole("tab", { name: "Typography", exact: true }).click();
  await expect(page.locator(".reading-document__page").getByRole("heading", { name: "Typography" })).toHaveCSS("font-family", /Liteasy-reader-en-0/);
  await expect(page.locator(".reading-document__page").getByRole("heading", { name: "Typography" })).toHaveCSS("font-family", /Liteasy-reader-zh-0/);
  await page.reload();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  for (const [label, value] of [["界面中文字体", "思源黑体"], ["界面英文字体", "Courier New"], ["阅读中文字体", "宋体"], ["阅读英文字体", "Cambria"]]) {
    await expect(settings.getByRole("combobox", { name: label, exact: true })).toHaveValue(value);
  }
});
