import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("compact conversation rows manage real titles, export and delete across restart", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const requests: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    if (localStorage.getItem("acceptance-chat-fixture")) return;
    localStorage.setItem("acceptance-chat-fixture", "true");
    localStorage.setItem("liteasy.assistant-history.v1", JSON.stringify({ version: "liteasy.assistant-history/v1", activeSessionId: "fixture-topic", draft: { input: "", tokens: [], readerContexts: [] }, sessions: [
      { id: "fixture-topic", title: "论文实验与误差分析", titleSource: "user", mode: "qa", kind: "conversation", status: "idle", createdAt: "2026-10-14T10:00:00Z", updatedAt: "2026-10-14T12:00:00Z", messages: [
        { id: "fixture-question", role: "user", content: "比较论文实验中的误差来源。" }, { id: "fixture-answer", role: "assistant", content: "需要区分采样偏差与测量误差。" }
      ] }
    ] }));
  });
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    const body = route.request().postDataJSON(); requests.push(JSON.stringify(body));
    const content = JSON.stringify(body.messages).includes("生成简短主题标题") ? "论文误差来源比较" : "连接测试响应。";
    if (body.stream) await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
    else await route.fulfill({ json: { choices: [{ message: { content } }] } });
  });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("需要区分采样偏差与测量误差。", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("region", { name: "应用设置" }).getByRole("button", { name: "AI 与助手", exact: true }).click();
  await page.getByRole("combobox", { name: "AI 接入方式" }).click();
  await page.getByRole("option", { name: /自备 API key/ }).click();
  await page.getByLabel("模型 ID", { exact: true }).fill("synthetic-title-model");
  await page.getByLabel("API key", { exact: true }).fill("synthetic-browser-only-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await page.getByRole("button", { name: "文献库", exact: true }).click();
  await page.getByRole("button", { name: "首页", exact: true }).click();
  const home = page.getByLabel("助手首页");
  const row = home.locator(".assistant-history-item").first();
  await expect(row.locator(".assistant-session-row-title")).toHaveText("论文实验与误差分析");
  await expect(row.locator(".assistant-session-row-date")).toBeVisible();
  await expect(row).not.toContainText("条消息");
  for (const width of [320, 560]) {
    // Resize the actual dock through its pointer control, keeping the whole pane inside the viewport.
    const pane = page.locator(".assistant-only-pane");
    const boundary = page.getByRole("separator", { name: "调整右栏宽度", exact: true });
    const paneBefore = (await pane.boundingBox())!;
    const handle = (await boundary.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + paneBefore.width - width, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await pane.boundingBox())!.width - width)).toBeLessThan(4);
    const rowBox = (await row.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(rowBox.x).toBeGreaterThanOrEqual(0);
    expect(rowBox.y).toBeGreaterThanOrEqual(0);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(viewport.width);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(viewport.height);
    const menu = home.getByRole("button", { name: "管理 论文实验与误差分析" });
    for (const control of [row.locator(".assistant-session-row-title"), row.locator(".assistant-session-row-date"), menu]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(rowBox.x);
      expect(box.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
    }
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "AI 重命名对话" })).toBeVisible();
    await page.keyboard.press("Escape");
    await row.screenshot({ path: testInfo.outputPath(`conversation-row-${width}.png`) });
    await pane.screenshot({ path: testInfo.outputPath(`conversation-pane-${width}.png`) });
  }
  await home.getByRole("button", { name: "管理 论文实验与误差分析" }).click();
  await page.getByRole("menuitem", { name: "AI 重命名对话" }).click();
  await expect(home.getByRole("button", { name: "打开会话：论文误差来源比较" })).toBeVisible();
  expect(requests.some(body => body.includes("比较论文实验中的误差来源"))).toBe(true);
  await home.getByRole("button", { name: "管理 论文误差来源比较" }).click();
  await page.getByRole("menuitem", { name: "重命名对话", exact: true }).click();
  await page.getByRole("textbox", { name: "会话名称" }).fill("采样与测量误差");
  await page.getByRole("button", { name: "保存名称" }).click();
  await home.getByRole("button", { name: "管理 采样与测量误差" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出对话" }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe("采样与测量误差.md");
  const text = await readFile((await exported.path())!, "utf8");
  expect(text).toContain("# 采样与测量误差");
  expect(text).toContain("比较论文实验中的误差来源。");
  expect(text).toContain("需要区分采样偏差与测量误差。");
  await home.getByRole("button", { name: "管理 采样与测量误差" }).click();
  await page.getByRole("menuitem", { name: "删除对话" }).click();
  await page.getByRole("dialog", { name: "删除对话确认" }).getByRole("button", { name: "删除对话" }).click();
  await expect(home.getByRole("button", { name: "打开会话：采样与测量误差" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.getByLabel("历史会话面板")).not.toContainText("采样与测量误差");
  expect(errors).toEqual([]);
});
