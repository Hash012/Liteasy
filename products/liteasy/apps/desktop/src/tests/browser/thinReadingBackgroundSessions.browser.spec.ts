import { expect, test } from "@playwright/test";

test("generates reading layers in the background and opens their session only from details", async ({ page }) => {
  test.setTimeout(90_000);
  const releases: Array<() => void> = [];
  const gates = [0, 1].map(() => new Promise<void>((resolve) => { releases.push(resolve); }));
  let requests = 0;
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    let content = "连接测试响应。";
    if (!prompt.includes("确认你已准备好")) {
      const index = requests++;
      await gates[index];
      content = JSON.stringify({ summary: index === 0
        ? "## 当前层概览\n\n[[[外部记忆]]] 保存论文中的历史信息。"
        : "## 外部记忆\n\n这一层解释状态如何被读取。",
        paperEvidence: [], omittedSections: [], recommendedFigures: [] });
    }
    await route.fulfill({ contentType: "text/event-stream", body:
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
  });
  try {
    await page.goto("/?pdf-highlight-fixture#importable");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("AI 接入方式").selectOption("direct");
    await page.getByLabel("模型 ID", { exact: true }).fill("background-reading-model");
    await page.getByLabel("API key", { exact: true }).fill("browser-only-key");
    await page.getByRole("button", { name: "保存并测试", exact: true }).click();
    await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
    await page.getByRole("button", { name: "文献库", exact: true }).click();
    await page.getByLabel("选择 das24a.pdf").check();
    await page.getByRole("button", { name: "锁定选中文献集", exact: true }).click();
    await page.getByRole("button", { name: "关闭 Liteasy Chat", exact: true }).click();
    await expect(page.locator(".assistant-pane")).not.toBeVisible();
    await page.getByRole("button", { name: "薄读", exact: true }).click();
    const status = page.locator(".thin-reading__generation-status");
    await expect(status).toContainText("生成中");
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator(".assistant-pane")).not.toBeVisible();
    await status.getByRole("button", { name: "详情", exact: true }).click();
    await expect(page.locator(".assistant-pane")).toBeVisible();
    await expect(page.getByLabel("当前会话")).toContainText("生成：薄读");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.getByPlaceholder("输入你的问题或命令").fill("保留当前草稿");
    releases[0]();
    await expect(page.locator(".thin-reading").getByRole("heading", { name: "当前层概览", exact: true })).toBeVisible();
    await expect(page.getByLabel("当前会话")).toContainText("普通对话");
    await expect(page.getByPlaceholder("输入你的问题或命令")).toHaveValue("保留当前草稿");
    await page.getByRole("button", { name: "关闭 Liteasy Chat", exact: true }).click();
    await page.getByRole("button", { name: "深入阅读“外部记忆”", exact: true }).click();
    await expect(status).toContainText("生成中");
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator(".assistant-pane")).not.toBeVisible();
    await status.getByRole("button", { name: "详情", exact: true }).click();
    await expect(page.getByLabel("当前会话")).toContainText("生成：薄读");
    releases[1]();
    await expect(page.getByTestId("thin-reading-summary").getByRole("heading", { name: "外部记忆", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "历史", exact: true }).click();
    await expect(page.getByRole("button", { name: /(?:当前|打开)会话：生成：薄读/ })).toHaveCount(1);
    expect(requests).toBe(2);
  } finally {
    releases.forEach((release) => release());
  }
});
