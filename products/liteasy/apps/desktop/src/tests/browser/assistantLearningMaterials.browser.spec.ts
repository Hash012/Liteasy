import { expect, test } from "@playwright/test";

test("offers learning-material commands in the scrollable slash menu and displays the selected capsule", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/?pdf-highlight-fixture");
  const input = page.getByPlaceholder("输入你的问题或命令");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("/");
  const menu = page.getByLabel("输入候选");
  for (const name of ["制作PPT", "制作提纲", "生成思维导图", "生成对比表", "生成分层关系图"]) {
    await expect(menu.getByRole("button", { name: new RegExp(name) })).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath("learning-material-commands.png"), fullPage: true });
  const lastCommand = menu.getByRole("button", { name: /把 AI 助手放到下栏/ });
  await lastCommand.scrollIntoViewIfNeeded();
  await expect(lastCommand).toBeVisible();
  await input.fill("/PPT");
  await menu.getByRole("button", { name: /制作PPT/ }).click();
  await expect(input).toHaveValue("/制作PPT ");
  await expect(page.locator(".assistant-command-chip")).toHaveText("/制作PPT");
  await expect(menu).toHaveCount(0);
});
