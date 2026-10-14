import { expect, test } from "@playwright/test";
test("research method selection stays separate from context and survives reload", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  const editor = page.getByPlaceholder("输入你的问题或命令");
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.fill("$research-read");
  await editor.press("Tab");
  await expect(page.getByRole("region", { name: "所选科研方法" })).toBeVisible();
  await expect(editor).toHaveValue("");
  await expect(page.getByRole("button", { name: "生成并保存", exact: true })).toBeVisible();
  await expect(page.getByText("已保存到此浏览器", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("research-skill-selection.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("region", { name: "所选科研方法" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "移除科研方法" }).click();
  await expect(page.getByRole("region", { name: "所选科研方法" })).toHaveCount(0);
});
