import { expect, test } from "@playwright/test";

test("keeps a failed thin-reading draft across reload and resumes with the original model and context", async ({ page }) => {
  test.setTimeout(90_000);
  let recover = false;
  const prompts: Array<{ model: string; prompt: string }> = [];
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    if (prompt.includes("确认你已准备好")) {
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: "连接测试响应。" } }] })}\n\ndata: [DONE]\n\n` });
      return;
    }
    prompts.push({ model: body.model, prompt });
    const content = recover
      ? JSON.stringify({ summary: "已保留之前的方法解释，并继续完成实验解读。", paperEvidence: [], omittedSections: [], recommendedFigures: [] })
      : '{"summary":"已经解释了外部记忆的方法，';
    await route.fulfill({ contentType: "text/event-stream", body:
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先阅读方法章节，再检查实验条件。" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + (recover ? "data: [DONE]\n\n" : "") });
  });
  await page.goto("/?pdf-highlight-fixture#importable");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("AI 接入方式").selectOption("direct");
  await page.getByLabel("模型 ID", { exact: true }).fill("original-model");
  await page.getByLabel("API key", { exact: true }).fill("browser-only-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await page.getByRole("button", { name: "文献库", exact: true }).click();
  await page.getByLabel("选择 das24a.pdf").check();
  await page.getByRole("button", { name: "锁定选中文献集", exact: true }).click();
  await page.getByRole("button", { name: "薄读", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续薄读", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(prompts).toHaveLength(3);
  await page.getByRole("button", { name: "分析 模型公开推理", exact: true }).click();
  await expect(page.getByText("先阅读方法章节，再检查实验条件。", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "继续薄读", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "分析 正文草稿", exact: true }).click();
  await expect(page.getByText("已经解释了外部记忆的方法，", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("模型 ID", { exact: true }).fill("new-setting-model");
  await page.getByLabel("API key", { exact: true }).fill("browser-only-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await page.getByRole("radio", { name: "严谨", exact: true }).check();
  recover = true;
  await page.getByRole("button", { name: "继续薄读", exact: true }).click();
  await expect(page.getByRole("button", { name: "打开薄读", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(prompts).toHaveLength(4);
  expect(prompts.at(-1)?.model).toBe("original-model");
  expect(prompts.at(-1)?.prompt).toContain("已经解释了外部记忆的方法");
  await expect(page.locator(".thin-reading").getByText("已保留之前的方法解释，并继续完成实验解读。", { exact: true })).toBeVisible();
});

test("configures MinerU, switches to reading mode, and restores the extracted material offline", async ({ page }) => {
  test.setTimeout(60_000);
  let requests = 0;
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("https://mineru.example.test/v1/pdf/mineru-extract", async (route) => {
    requests++;
    expect(route.request().headers().authorization).toBe("Bearer browser-mineru-key");
    expect(route.request().postDataJSON().bytesBase64).toBeTruthy();
    await route.fulfill({ json: { pages: [{ page: 1, text: "MinerU extracted the paper methods and experiments." }], markdown: "# 阅读模式正文\n\nMinerU extracted the paper methods and experiments.", figures: [] } });
  });
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(page.getByRole("button", { name: "阅读模式", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "das24a.pdf", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "确认文献身份", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "编辑分类与标签", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑论文分类与标签" })).toBeVisible();
  await page.getByRole("textbox", { name: "论文分类" }).fill("已解析");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑论文分类与标签" })).toHaveCount(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("论文内容解析").selectOption("custom");
  await page.getByLabel("MinerU API 地址").fill("https://mineru.example.test");
  await page.getByLabel("mineru API key", { exact: true }).fill("browser-mineru-key");
  await page.getByRole("button", { name: "保存密钥", exact: true }).last().click();
  await expect(page.getByText("密钥已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "MinerU 解析", exact: true }).click();
  await expect(page.getByRole("button", { name: "阅读模式", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "阅读模式", exact: true }).click();
  await expect(page.getByLabel("论文阅读模式").getByRole("heading", { name: "阅读模式正文" })).toBeVisible();
  await page.getByRole("button", { name: "PDF 模式", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "PDF 导航工具栏" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "阅读模式", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "阅读模式", exact: true }).click();
  await expect(page.getByLabel("论文阅读模式").getByRole("heading", { name: "阅读模式正文" })).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.getByLabel("左边栏导航").getByRole("toolbar", { name: "阅读区布局控制" })).toBeVisible();
  await expect(page.getByLabel("PDF 标题栏")).toHaveCount(0);
  await page.screenshot({ path: "test-results/mineru-reading-mode.png", fullPage: true });
});
