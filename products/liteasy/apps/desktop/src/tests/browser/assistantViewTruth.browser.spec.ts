import { expect, test } from "@playwright/test";

test("assistant home, task list and selected run logs are exclusive with real production styling", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/assistant-root-cause.html");
  await expect(page.getByText("旧对话中的回答", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.getByRole("log", { name: "对话消息" })).toHaveCount(0);
  await expect(page.getByPlaceholder("输入你的问题或命令")).toHaveCount(0);
  await page.getByRole("button", { name: "打开会话：生成：薄读" }).click();
  await expect(page.getByText("本次失败 · 已保存结果可用")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("离线新运行失败");
  await expect(page.getByText("薄读未完成：离线新运行失败", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "运行详情", exact: true }).click();
  await expect(page.getByText("薄读未完成：离线新运行失败", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "选择运行记录" }).click();
  await page.getByRole("option", { name: "第 1 次 · 已完成", exact: true }).click();
  await expect(page.getByText("薄读已保存，可打开阅读，也可在 Lib 的对应论文下重新打开。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({ path: info.outputPath("task-detail-dark.png") });
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByLabel("助手首页")).toBeVisible();
  await expect(page.getByRole("log", { name: "对话消息" })).toHaveCount(0);
  await expect(page.locator(".assistant-save-status")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("home-dark.png") });
  await page.getByPlaceholder("输入你的问题或命令").fill("保留新草稿");
  await expect(page.getByText("已保存到此浏览器", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("输入你的问题或命令")).toHaveValue("保留新草稿");
});
