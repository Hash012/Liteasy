import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("drags a saved thin-reading entry into chat, sends its body, and scrolls a long Agent reply", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const prompts: string[] = [];
  const answer = Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 段：结合上下文解释注意力与归一化，这是用于验证长回答可浏览的段落。`).join("\n\n");
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    prompts.push(prompt);
    const content = prompt.includes("确认你已准备好") ? "连接测试响应。" : prompt.includes("目录甲正文") ? "已读取目录甲文件。" : answer;
    if (body.stream) await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
    else await route.fulfill({ json: { choices: [{ message: { content } }] } });
  });
  await page.setViewportSize({ width: 1700, height: 950 });
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(page.locator(".assistant-pane")).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = "/src/app/features/artifacts/localArtifactResultClient.ts";
    const { createLocalArtifactResultClient } = await import(modulePath);
    await createLocalArtifactResultClient().save({
      agent: { apiVersion: "1", runId: "browser-context", sessionId: "browser", status: "completed" },
      artifactId: "thin-context-browser", artifactType: "thin_reading", answer: "文库薄读原始内容：注意力归一化保留相对权重。", citations: [],
      createdAt: new Date().toISOString(), papers: [{ id: "manual-das24a-preview", title: "das24a.pdf" }],
      title: "注意力薄读", version: "liteasy.agent-artifact/v1",
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("AI 接入方式").selectOption("direct");
  await page.getByLabel("模型 ID", { exact: true }).fill("browser-context-model");
  await page.getByLabel("API key", { exact: true }).fill("browser-only-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await page.getByRole("button", { name: "文献库", exact: true }).click();
  const source = page.getByRole("button", { name: "打开论文文件：注意力薄读", exact: true });
  await expect(source).toBeVisible();
  await source.dragTo(page.locator(".assistant-input-wrap"));
  await expect(page.getByRole("button", { name: "移除上下文：注意力薄读", exact: true })).toBeVisible();
  await page.getByPlaceholder("输入你的问题或命令").fill("请结合这份薄读解释注意力");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText(/第 60 段：/)).toBeVisible({ timeout: 30_000 });
  expect(prompts.some((prompt) => prompt.includes("文库薄读原始内容：注意力归一化保留相对权重"))).toBe(true);
  const messages = page.locator(".assistant-messages");
  const metrics = await messages.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    return { before, after: element.scrollTop, height: element.clientHeight, content: element.scrollHeight };
  });
  expect(metrics.content).toBeGreaterThan(metrics.height + 400);
  expect(metrics.after).toBeGreaterThan(0);
  await expect(page.getByText(/第 60 段：/)).toBeInViewport();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
  await messages.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByText(/第 1 段：/).first()).toBeInViewport();
  await page.getByPlaceholder("输入你的问题或命令").fill("@注意力薄读");
  await page.getByPlaceholder("输入你的问题或命令").press("Enter");
  await expect(page.getByRole("button", { name: "移除上下文：注意力薄读", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除上下文：注意力薄读", exact: true }).click();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("context-paths", { create: true });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => directory });
    const modulePath = "/src/app/features/note-files/noteFileService.ts";
    const { createNoteFileService } = await import(modulePath);
    const service = createNoteFileService("local", () => "local");
    const mount = await service.chooseFolder();
    for (const folder of ["project-a", "project-b"]) {
      await service.createDirectory(mount.id, folder);
      await service.writeFile({ mountId: mount.id, path: `${folder}/review.md`, expectedVersion: null,
        text: folder === "project-a" ? "目录甲正文：只对这一份方法笔记做解释。" : "目录乙正文：不应被选入这次问题。" });
    }
  });
  await page.getByPlaceholder("输入你的问题或命令").fill("@context-paths/project-a/review.md");
  await expect(page.getByRole("button", { name: /review.md.*context-paths\/project-a/ })).toBeVisible();
  await page.getByPlaceholder("输入你的问题或命令").press("Enter");
  await expect(page.getByRole("button", { name: "移除上下文：review.md", exact: true })).toBeVisible();
  await page.getByPlaceholder("输入你的问题或命令").fill("解释所选方法笔记");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已读取目录甲文件。", { exact: true })).toBeVisible();
  expect(prompts.at(-1)).toContain("目录甲正文");
  expect(prompts.at(-1)).not.toContain("目录乙正文");
  await messages.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  if (process.env.LITEASY_SCREENSHOT_FONT) {
    const font = (await readFile(process.env.LITEASY_SCREENSHOT_FONT)).toString("base64");
    await page.addStyleTag({ content: `@font-face { font-family: "Screenshot Chinese"; src: url(data:font/ttf;base64,${font}); } body, body * { font-family: "Screenshot Chinese", sans-serif !important; }` });
    await page.evaluate(() => document.fonts.ready);
  }
  await page.getByPlaceholder("输入你的问题或命令").fill("/");
  const commands = page.locator(".assistant-suggestion-menu.commands");
  await expect(commands).toBeVisible();
  const commandSizes = await commands.locator(".assistant-suggestion-item").evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height));
  expect(commandSizes.length).toBeGreaterThan(6);
  expect(Math.max(...commandSizes)).toBeLessThanOrEqual(32);
  expect((await commands.boundingBox())!.height).toBeLessThanOrEqual(210);
  await page.screenshot({ path: testInfo.outputPath("agent-command-menu.png"), fullPage: true, animations: "disabled" });
  await page.getByPlaceholder("输入你的问题或命令").press("Escape");
  await page.getByPlaceholder("输入你的问题或命令").fill("");

  await messages.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: testInfo.outputPath("agent-context-scroll.png"), fullPage: true, animations: "disabled" });
});
