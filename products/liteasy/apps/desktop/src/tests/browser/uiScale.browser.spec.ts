import { expect, test } from "@playwright/test";

for (const sample of [
  { language: "zh-CN", theme: "light", size: "14", scale: "100" },
  { language: "en-US", theme: "dark", size: "24", scale: "200" }
]) test(`Studio remains editable with ${sample.language}, ${sample.theme}, font ${sample.size}, scale ${sample.scale}%`, async ({ page }, info) => {
  await page.addInitScript(settings => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.language": settings.language, "view.theme": settings.theme, "view.font_size": settings.size, "view.display_scale": settings.scale }));
  }, sample);
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", sample.theme);
  await page.locator('.activity-bar button[aria-label="扩展"]').click();
  await page.getByRole("button", { name: "制作扩展", exact: true }).click();
  await page.getByRole("button", { name: "开始离线演示", exact: true }).click();
  const studio = page.locator(".workflow-studio");
  const properties = studio.getByRole("button", { name: "属性", exact: true });
  if (await properties.isVisible()) await properties.click();
  await studio.getByRole("button", { name: "研究问题", exact: true }).click();
  const body = studio.getByRole("textbox", { name: "卡片正文", exact: true });
  await body.fill("## 字体与缩放验收\n\nSynthetic content retained at user scale.");
  await expect(body).toBeFocused();
  await studio.getByRole("button", { name: "校验与预览", exact: true }).click();
  await expect(studio.locator(".studio-preview")).toContainText("Synthetic content retained");
  await studio.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(studio.getByText("离线示例", { exact: true })).toBeVisible();
  await studio.getByRole("button", { name: "制作工作台帮助" }).click();
  await expect(page.getByText("已修改 · 已预览 · 已保存", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("scale.png"), fullPage: true });
});
