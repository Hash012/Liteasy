import { expect, test } from "@playwright/test";

test("finds a note by a partial name, saves through real Agent tools, and presents the receipt in both themes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const prompts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    let content = "连接测试响应。";
    if (prompt.includes("真实工具结果（数据）：")) {
      prompts.push(prompt);
      const observations = JSON.parse(prompt.split("真实工具结果（数据）：")[1].split("\n")[0]);
      const attached = JSON.parse(prompt.split("附加资产（仅元信息）：")[1].split("\n")[0]);
      const target = attached.find((asset: { title: string }) => asset.title.includes("CicN"));
      const action = { action: "answer", message: "已把 Cicada 资料的要点写入 CicN，并保留了原有标题。", query: "", path: "", text: "", expectedRevision: "", mode: "append", offset: 0 };
      if (observations.length === 0) Object.assign(action, { action: "read", path: target.path });
      else if (observations.length === 1) Object.assign(action, { action: "search", query: "Cicada资料" });
      else if (observations.length === 2) Object.assign(action, { action: "read", path: observations[1].result[0].path });
      else if (observations.length === 3) Object.assign(action, { action: "write", path: target.path,
        expectedRevision: observations[0].result.asset.revision,
        text: "\n\n## Cicada 要点\nCicada 使用乐观并发控制与多版本数据管理，降低事务竞争成本。\n来源：Cicada资料.md。" });
      content = JSON.stringify(action);
    }
    if (body.stream) await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
    else await route.fulfill({ json: { choices: [{ message: { content } }] } });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const rail = page.getByRole("navigation", { name: "左边栏导航" });
  await rail.getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  for (const [name, text] of [["CicN.md", "# CicN"], ["Cicada资料.md", "# Cicada 资料\nCicada 使用乐观并发控制与多版本数据管理，降低事务竞争成本。"]]) {
    const chooser = page.waitForEvent("filechooser");
    await notes.getByRole("button", { name: "导入 Markdown 文件", exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
    await expect(notes.getByRole("button", { name: `查看笔记 ${name}`, exact: true })).toBeVisible();
  }
  await rail.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("AI 接入方式").selectOption("direct");
  await page.getByLabel("模型 ID", { exact: true }).fill("browser-agent-workspace");
  await page.getByLabel("API key", { exact: true }).fill("browser-fixture-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "上下文资产浏览器" });
  await browser.getByRole("textbox", { name: "搜索全部上下文资产" }).fill("Cic");
  await browser.getByRole("button", { name: "预览 CicN.md", exact: true }).click();
  await expect(browser.getByRole("complementary", { name: "资产预览" })).toContainText("可编辑");
  await page.screenshot({ path: testInfo.outputPath("agent-context-browser.png"), animations: "disabled" });
  await browser.getByRole("button", { name: "加入对话", exact: true }).click();
  await expect(browser).not.toBeVisible();
  await expect(page.getByRole("button", { name: "移除上下文：CicN.md", exact: true })).toBeVisible();
  await page.getByPlaceholder("输入你的问题或命令").fill("把 Cicada资料 中的要点写入这个笔记。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("已保存的资产修改")).toContainText("已更新 CicN.md", { timeout: 30_000 });
  await expect(page.getByText("已把 Cicada 资料的要点写入 CicN，并保留了原有标题。", { exact: true })).toBeVisible();
  expect(prompts).toHaveLength(5);
  expect(prompts[0]).not.toContain("Cicada 使用乐观并发控制");
  expect(prompts[3]).toContain("Cicada 使用乐观并发控制");
  await expect(page.getByRole("meter", { name: "上下文占用" })).toHaveAttribute("aria-valuemax", "32768");
  const activity = page.getByRole("button", { name: "查看 Agent 执行过程" });
  await expect(activity).toHaveAttribute("aria-expanded", "false");
  await activity.click();
  await expect(page.getByRole("list", { name: "Agent 执行步骤" })).toBeVisible();
  await expect(page.getByRole("button", { name: "已保存 · CicN.md", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "已保存 · CicN.md", exact: true }).click();
  await expect(page.locator(".assistant-agent-step-detail")).toContainText("行");
  await page.locator(".assistant-messages").evaluate((element) => { element.scrollTop = 0; });
  await page.locator(".assistant-pane").screenshot({ path: testInfo.outputPath("agent-workspace-expanded.png"), animations: "disabled" });
  await activity.click();
  await page.getByLabel("已保存的资产修改").scrollIntoViewIfNeeded();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", theme);
    await page.locator(".assistant-pane").screenshot({ path: testInfo.outputPath(`agent-workspace-${theme}.png`), animations: "disabled" });
  }
  await page.getByLabel("已保存的资产修改").getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("region", { name: "内容详情", exact: true })).toContainText("Cicada 使用乐观并发控制");
  await page.reload();
  await expect(page.getByLabel("已保存的资产修改")).toContainText("已更新 CicN.md");
  expect(errors).toEqual([]);
});
