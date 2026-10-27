import { expect, test } from "@playwright/test";

test("running A stays in A while B keeps its draft through background completion and reload", async ({ page }) => {
  test.setTimeout(90_000);
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = JSON.stringify(body.messages);
    if (prompt.includes("session ownership A")) { started = true; await gate; }
    let content = prompt.includes("session ownership A") ? "Synthetic fixture: A completed in its original conversation." : "连接测试响应。";
    if (prompt.includes("生成简短主题标题")) content = "session ownership A";
    if (prompt.includes("真实工具结果（数据）：")) content = JSON.stringify({ action: "answer", message: content, query: "", path: "", text: "", expectedRevision: "", mode: "append", offset: 0 });
    if (body.stream) await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
    else await route.fulfill({ json: { choices: [{ message: { content } }] } });
  });
  try {
    await page.goto("/?pdf-highlight-fixture#importable");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("region", { name: "应用设置" }).getByRole("button", { name: "AI 与助手", exact: true }).click();
    await page.getByRole("combobox", { name: "AI 接入方式" }).click();
    await page.getByRole("option", { name: /自备 API key/ }).click();
    await page.getByLabel("模型 ID", { exact: true }).fill("synthetic-session-model");
    await page.getByLabel("API key", { exact: true }).fill("synthetic-browser-only-key");
    await page.getByRole("button", { name: "保存并测试", exact: true }).click();
    await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
    await page.getByRole("button", { name: "文献库", exact: true }).click();
    const composer = page.getByPlaceholder("输入你的问题或命令");
    await composer.fill("session ownership A");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await composer.fill("Synthetic fixture: B's draft");
    await composer.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(2, 10); });
    release();
    await expect(page.getByRole("button", { name: "终止", exact: true })).toHaveCount(0);
    await expect(composer).toHaveValue("Synthetic fixture: B's draft");
    await expect(composer).toBeFocused();
    expect(await composer.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 10]);
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await page.getByRole("button", { name: "打开会话：session ownership A", exact: true }).click();
    await expect(page.getByText("Synthetic fixture: A completed in its original conversation.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await page.getByRole("button", { name: "打开会话：新对话", exact: true }).click();
    await expect(composer).toHaveValue("Synthetic fixture: B's draft");
    await expect(page.getByText("已保存到此浏览器", { exact: true })).toBeVisible();
    await page.reload();
    await expect(composer).toHaveValue("Synthetic fixture: B's draft");
    for (const width of [320, 400, 560]) {
      await page.locator(".assistant-only-pane").evaluate((element, width) => { element.style.width = `${width}px`; element.style.maxWidth = `${width}px`; }, width);
      await expect(page.getByRole("button", { name: "新建", exact: true })).toBeVisible();
      await page.locator(".assistant-only-pane").screenshot({ path: `test-results/assistant-synthetic-${width}.png` });
    }
  } finally { release(); }
});
