import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function openReader(page: Page, fixture = "selection-lookup") {
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.model-connection.v1", JSON.stringify({ "models.connection_mode": "direct", "models.direct_provider": "ollama",
      "models.direct_endpoint": "http://localhost:11434/v1", "models.direct_model": "lookup-test", "models.direct_protocol": "openai" }));
  });
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`/?pdf-highlight-fixture#${fixture}`);
  const paper = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(paper.locator(".pdf-text-layer")).not.toBeEmpty({ timeout: 30_000 });
  return paper;
}
async function selectPdfText(page: Page, paper: Locator) {
  const span = paper.locator(".pdf-text-layer span").filter({ hasText: /\S{4}/ }).first();
  const bounds = (await span.boundingBox())!;
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 10 }); await page.mouse.up();
  return page.getByLabel("选中文本批注菜单");
}

for (const entry of ["selection", "dictionary"] as const) test(`AI word lookup from ${entry} sends only a term without paper context`, async ({ page }, testInfo) => {
  const modelRequests: { messages: { role: string; content: string }[] }[] = [];
  let dictionaryRequests = 0;
  await page.route("https://cn.bing.com/dict/search?**", (route) => {
    dictionaryRequests++;
    return route.fulfill({ contentType: "text/html", headers: { "Access-Control-Allow-Origin": "*" },
      body: '<div class="qdef"><ul><li><span class="def">原词典释义</span></li></ul></div>' });
  });
  await page.route("http://localhost:11434/v1/chat/completions", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    modelRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: { choices: [{ message: { content: "**核心释义**：一个简短例子。" } }] }, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const paper = await openReader(page), menu = await selectPdfText(page, paper);
  const card = menu.getByRole("region", { name: "查词与翻译结果" });
  if (entry === "dictionary") {
    await menu.getByRole("button", { name: "查词/翻译", exact: true }).click();
    await expect(card.getByText("原词典释义", { exact: true })).toBeVisible();
    expect(modelRequests).toHaveLength(0);
    await card.getByRole("button", { name: "AI 查词", exact: true }).click();
  } else await menu.getByRole("button", { name: "AI 查词", exact: true }).click();
  await expect(card.getByText("核心释义", { exact: true })).toBeVisible();
  expect(modelRequests).toHaveLength(1);
  expect(dictionaryRequests).toBe(entry === "dictionary" ? 1 : 0);
  const messages = modelRequests[0].messages;
  expect(messages).toHaveLength(1);
  const term = await card.locator("header > strong").innerText();
  expect(messages[0].content).toContain(`待解释的词：${JSON.stringify(term)}`);
  expect(messages[0].content).not.toContain("das24a");
  expect(messages[0].content.length).toBeLessThan(500);
  expect(await menu.evaluate((element) => { const r = element.getBoundingClientRect(); return r.right <= window.innerWidth && r.bottom <= window.innerHeight; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`ai-word-${entry}.png`) });
});

test("looks up a PDF selection, expands senses and persists the result as a shared annotation", async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route("https://cn.bing.com/dict/search?**", (route) => {
    requests.push(new URL(route.request().url()).searchParams.get("q")!);
    return route.fulfill({ contentType: "text/html", headers: { "Access-Control-Allow-Origin": "*" },
      body: '<div class="qdef"><ul><li><span class="pos">n.</span><span class="def">首个查询释义</span></li><li><span class="def">第二个释义</span></li><li><span class="def">第三个释义</span></li><li><span class="def">更多查询释义</span></li></ul></div>' });
  });
  const paper = await openReader(page), menu = await selectPdfText(page, paper);
  await expect(menu.getByRole("button", { name: "查词/翻译" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await menu.getByRole("button", { name: "查词/翻译" }).click();
  const card = menu.getByRole("region", { name: "查词与翻译结果" });
  await expect(card.getByText("首个查询释义", { exact: true })).toBeVisible();
  expect(requests[0].length).toBeGreaterThan(0);
  await expect(card.getByText("更多查询释义", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "更多释义与例句" }).click();
  await expect(card.getByText("更多查询释义", { exact: true })).toBeVisible();
  expect(await menu.evaluate((element) => { const r = element.getBoundingClientRect(); return r.right <= window.innerWidth && r.bottom <= window.innerHeight; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("pdf-selection-lookup.png") });
  await card.getByRole("button", { name: "保存为批注" }).click();
  await expect(card.getByRole("status")).toHaveText("查询结果已保存为批注。");
  await expect(page.locator(".pdf-annotation-item")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".pdf-annotation-item")).toHaveCount(1);
  await page.locator(".pdf-annotation-summary").first().click();
  await expect(page.getByLabel("补充批注笔记")).toHaveValue(/首个查询释义[\s\S]*来源：必应词典/);
});

test("opens an AI translation only after confirmation and sends the customized prompt", async ({ page }, testInfo) => {
  const modelRequests: Record<string, unknown>[] = [];
  await page.route("https://cn.bing.com/dict/search?**", (route) => route.fulfill({ contentType: "text/html", headers: { "Access-Control-Allow-Origin": "*" }, body: "<html>Missing term</html>" }));
  await page.route("http://localhost:11434/v1/chat/completions", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    modelRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: { choices: [{ message: { content: "上下文译文" } }] }, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const paper = await openReader(page), menu = await selectPdfText(page, paper);
  await menu.getByRole("button", { name: "查词/翻译" }).click();
  const card = menu.getByRole("region", { name: "查词与翻译结果" });
  await expect(card.getByText("未找到词典释义，可翻译这个选段。")).toBeVisible();
  expect(modelRequests).toHaveLength(0);
  await expect(card.getByRole("textbox", { name: "本次系统提示词" })).toHaveCount(0);
  await card.getByRole("combobox", { name: "生成风格" }).selectOption("concise");
  await card.getByRole("button", { name: "自定义系统提示词" }).click();
  await card.getByRole("textbox", { name: "本次系统提示词" }).fill("保留论文中的缩写，只给出译文");
  await card.getByRole("button", { name: "翻译选段", exact: true }).click();
  await expect(card.getByText("上下文译文", { exact: true })).toBeVisible();
  expect(modelRequests).toHaveLength(1);
  expect(JSON.stringify(modelRequests[0])).toContain("保留论文中的缩写，只给出译文");
  await page.screenshot({ path: testInfo.outputPath("pdf-selection-ai-translation.png") });
});

test("finds centralized settings and restores automatic lookup preferences after reload", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  async function openSettings() {
    await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "应用设置" });
    await settings.getByRole("textbox", { name: "搜索设置" }).fill("查词");
    return settings;
  }
  let settings = await openSettings();
  await settings.getByRole("combobox", { name: "词典服务" }).selectOption("youdao");
  await settings.getByRole("switch", { name: "自动查询选区" }).check();
  await page.reload(); settings = await openSettings();
  await expect(settings.getByRole("combobox", { name: "词典服务" })).toHaveValue("youdao");
  await expect(settings.getByRole("switch", { name: "自动查询选区" })).toBeChecked();
});

test("automatically queries a reading-mode word with its sentence and shares the saved note with PDF mode", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem("liteasy.selection-lookup.v1", JSON.stringify({ "lookup.auto_query": true })));
  const requests: string[] = [];
  await page.route("https://cn.bing.com/dict/search?**", (route) => {
    requests.push(new URL(route.request().url()).searchParams.get("q")!);
    return route.fulfill({ contentType: "text/html", headers: { "Access-Control-Allow-Origin": "*" },
      body: '<div class="qdef"><ul><li><span class="pos">n.</span><span class="def">正则化</span></li></ul></div>' });
  });
  const sentence = "We apply regularization to the model.";
  await page.route("https://lookup-reading.example.test/v1/pdf/mineru-extract", (route) => route.fulfill({ json: {
    pages: [{ page: 1, text: sentence }], markdown: `# Methods\n\n${sentence}`, figures: [],
  } }));
  await openReader(page, "importable");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("region", { name: "应用设置" }).getByRole("button", { name: "论文与推荐" }).click();
  await page.getByLabel("论文内容解析").selectOption("custom");
  await page.getByLabel("MinerU API 地址").fill("https://lookup-reading.example.test");
  await page.getByLabel("mineru API key", { exact: true }).fill("lookup-reading-test-key");
  await page.getByRole("button", { name: "保存密钥", exact: true }).last().click();
  await page.getByRole("button", { name: "关闭 设置", exact: true }).click();
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  await page.getByRole("button", { name: "MinerU 解析", exact: true }).click();
  await page.getByRole("button", { name: "阅读模式", exact: true }).click();
  const reading = page.getByRole("region", { name: "论文阅读模式", exact: true });
  await reading.locator(".mineru-markdown p").filter({ hasText: sentence }).evaluate((element) => {
    const node = element.firstChild!;
    const start = node.textContent!.indexOf("regularization");
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + "regularization".length);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const card = reading.getByRole("region", { name: "查词与翻译结果" });
  await expect(card.getByText("正则化", { exact: true })).toBeVisible();
  expect(requests).toEqual(["regularization"]);
  await card.getByText("翻译选段", { exact: true }).first().click();
  await card.getByText("所在句子", { exact: true }).click();
  await expect(card.getByText(sentence, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "保存为批注" }).click();
  await expect(card.getByRole("status")).toHaveText("查询结果已保存为批注。");
  await reading.getByRole("button", { name: "PDF 模式", exact: true }).click();
  const annotation = page.locator(".pdf-annotation-item");
  await expect(annotation).toHaveCount(1);
  await annotation.locator(".pdf-annotation-summary").click();
  await expect(annotation.getByLabel("补充批注笔记")).toHaveValue("n. 正则化\n来源：必应词典");
});
