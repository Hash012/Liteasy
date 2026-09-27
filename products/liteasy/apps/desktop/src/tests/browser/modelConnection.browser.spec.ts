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

test("composer expands thinking control and switches between separately verified APIs", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const requests: { host: string; model: string; key: string; prompt: string }[] = [];
  let releaseReply!: () => void;
  const replyGate = new Promise<void>((resolve) => { releaseReply = resolve; });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route(/^https:\/\/(fast|careful)\.example\.test\/v1\/chat\/completions$/, async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    requests.push({ host: new URL(route.request().url()).hostname, model: body.model, key: route.request().headers().authorization, prompt });
    const testing = prompt.includes("确认你已准备好");
    if (!testing) await replyGate;
    const answer = testing ? "已验证测试连接。" : `来自 ${body.model} 的回答。`;
    await route.fulfill({ status: 200, contentType: body.stream ? "text/event-stream" : "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: body.stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: "stop" }] }) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("slider", { name: "思考深度" })).toHaveCount(0);
  await page.getByRole("button", { name: "调整思考深度：均衡" }).click();
  const slider = page.getByRole("slider", { name: "思考深度" });
  await slider.focus(); await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "熟虑");
  await page.getByLabel("思考深度设置").screenshot({ path: testInfo.outputPath("thinking-depth.png") });
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", "快速");
  await page.keyboard.press("Escape");
  await expect(slider).toHaveCount(0);
  await expect(page.getByRole("button", { name: "调整思考深度：快速" })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("AI 接入方式").selectOption("direct");
  await page.getByLabel("API 服务商").selectOption("custom");
  for (const name of ["fast", "careful"]) {
    await page.getByLabel("API 基础地址").fill(`https://${name}.example.test/v1`);
    await page.getByLabel("模型 ID", { exact: true }).fill(`research-${name}`);
    await page.getByLabel("API key", { exact: true }).fill(`browser-only-${name}-key`);
    await page.getByRole("button", { name: "保存并测试", exact: true }).click();
    await expect(page.getByLabel("测试响应")).toHaveValue("已验证测试连接。");
  }
  await page.getByRole("button", { name: "切换模型：research-careful" }).click();
  const models = page.getByRole("group", { name: "已验证模型" });
  await expect(models.getByRole("button")).toHaveCount(2);
  await page.getByLabel("选择对话模型").screenshot({ path: testInfo.outputPath("model-picker.png") });
  await models.getByRole("button", { name: /research-fast/ }).click();
  await expect(page.getByRole("button", { name: "切换模型：research-fast" })).toBeVisible();
  await page.getByPlaceholder("输入你的问题或命令").fill("请介绍一下你能如何帮助阅读论文。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "切换模型：research-fast" })).toBeDisabled();
  releaseReply();
  await expect(page.getByRole("article", { name: "AI 回复" }).getByText("来自 research-fast 的回答。", { exact: false })).toBeVisible({ timeout: 20_000 });
  const chat = requests.filter((request) => !request.prompt.includes("确认你已准备好"));
  expect(chat.length).toBeGreaterThan(0);
  expect(chat.every((request) => request.host === "fast.example.test" && request.model === "research-fast" && request.key === "Bearer browser-only-fast-key")).toBe(true);
  expect(chat.some((request) => request.prompt.includes("思考深度：快速"))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("liteasy.verified-models.v1"))).not.toContain("browser-only");
  await page.reload();
  await page.getByRole("button", { name: "切换模型：research-fast" }).click();
  await expect(page.getByText(/暂无已验证模型/)).toBeVisible();
});
