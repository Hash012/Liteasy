import { expect, test } from "@playwright/test";

test("configures a personal API and generates a chat answer without signing in", async ({ page }) => {
  const modelRequests: string[] = [];
  const cloudRequests: string[] = [];
  await page.addInitScript(() => {
    if (!localStorage.getItem("liteasy.model-connection.v1")) localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
  });
  page.on("request", (request) => {
    if (request.url().includes("/v1/model/")) cloudRequests.push(request.url());
  });
  // Only this browser test supplies a response fixture. Product requests use the
  // provider's API; no fixture credentials or answers are shipped with the app.
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    modelRequests.push(body.model);
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    const answer = prompt.includes("确认你已准备好") ? "连接测试响应。" : "这是未登录直连生成的浏览器测试回答。";
    await route.fulfill({
      status: 200,
      contentType: body.stream ? "text/event-stream" : "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: body.stream
        ? `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: "stop" }] })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("AI 接入方式").selectOption("direct");
  await page.getByLabel("模型 ID", { exact: true }).fill("gpt-5-mini");
  await page.getByLabel("API key", { exact: true }).fill("browser-test-only-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await page.getByPlaceholder("输入你的问题或命令").fill("你好，请简单介绍你如何帮助阅读论文。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("article", { name: "AI 回复" }).getByText("这是未登录直连生成的浏览器测试回答。", { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(modelRequests.length).toBeGreaterThanOrEqual(2);
  expect(cloudRequests).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("browser-test-only-key");
  const requestCount = modelRequests.length;
  await page.getByPlaceholder("输入你的问题或命令").fill("请继续解释论文方法");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("article", { name: "AI 回复" }).getByText("这是未登录直连生成的浏览器测试回答。", { exact: false })).toBeVisible();
  // Non-secret configuration survives refresh; browser-only keys intentionally do not.
  await page.evaluate(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "false"));
  await page.reload();
  await expect(page.getByRole("article", { name: "AI 回复" }).getByText("这是未登录直连生成的浏览器测试回答。", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("输入你的问题或命令")).toHaveValue("请继续解释论文方法");
  expect(modelRequests).toHaveLength(requestCount);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("AI 接入方式")).toHaveValue("direct");
  await expect(page.getByRole("dialog", { name: "轻量登录面板" })).toHaveCount(0);
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请填写 API key");
});
