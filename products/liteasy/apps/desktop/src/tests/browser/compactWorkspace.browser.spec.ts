import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const title = "Larimar: Large Language Models with Episodic Memory Control";

test("narrow library rows prioritize single-line names and reveal tags again when widened", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture#importable");
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  await library.getByRole("button", { name: "das24a.pdf", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑元信息", exact: true }).click();
  const editor = page.getByRole("form", { name: "编辑文献元信息" });
  await editor.getByRole("textbox", { name: "标题", exact: true }).fill(title);
  await editor.getByRole("button", { name: "添加作者", exact: true }).click();
  await editor.getByRole("textbox", { name: "作者 1", exact: true }).fill("Payel Das");
  await editor.getByRole("textbox", { name: "出版日期", exact: true }).fill("2024");
  await editor.getByRole("button", { name: "保存元信息", exact: true }).click();
  const paper = library.getByRole("button", { name: title, exact: true });
  await expect(paper).toBeVisible();
  const left = page.locator('[data-region="left"]');
  const separator = page.getByRole("separator", { name: "调整分栏宽度", exact: true }).first();
  async function resize(width: number) {
    const box = (await separator.boundingBox())!;
    const current = (await left.boundingBox())!.width;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + width - current, box.y + 100, { steps: 6 });
    await page.mouse.up();
  }
  const row = paper.locator('xpath=ancestor::div[contains(@class,"library-paper-row")]');
  await resize(280);
  await expect(row.locator(".library-tag-chips")).toBeHidden();
  await expect(row.getByRole("button", { name: "位置与 Liteasy Path" })).toBeHidden();
  const name = paper.locator(".library-paper-title-text");
  await expect(name).toHaveCSS("white-space", "nowrap");
  await expect(name).toHaveCSS("text-overflow", "ellipsis");
  expect(await name.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect((await row.boundingBox())!.height).toBeLessThan(42);
  await expect(paper).toHaveAttribute("title", title);
  await paper.click();
  await expect(page.getByRole("contentinfo", { name: "文件状态栏" })).toContainText(title);
  await page.screenshot({ path: testInfo.outputPath("narrow-library.png") });
  const narrow = (await name.boundingBox())!.width;
  await resize(500);
  await expect(row.locator(".library-tag-chips")).toBeVisible();
  expect((await name.boundingBox())!.width).toBeGreaterThan(narrow);
  await page.emulateMedia({ colorScheme: "dark" });
  await resize(280);
  await expect(row.locator(".library-tag-chips")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("narrow-library-dark.png") });
});

test("chat has a reading gutter and compact context chips retain complete source titles", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(({ title }) => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.assistant-history.v1", JSON.stringify({
      version: "liteasy.assistant-history/v1", activeSessionId: "density-chat",
      draft: { input: "", tokens: [], readerContexts: [] },
      sessions: [{ id: "density-chat", title: "论文比较", kind: "conversation", mode: "qa", status: "idle",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [
          { id: "question", role: "user", content: `${title} Cicada 请比较这些论文。`, contextTokens: [
            { id: "long", kind: "paper", label: title, prompt: "" }, { id: "short", kind: "paper", label: "Cicada", prompt: "" },
          ] },
          { id: "answer", role: "assistant", content: "## 两篇论文\n\n保留足够的左右留白，让长段落也方便阅读。\n\n这里是第二段正文。" },
        ] }],
    }));
  }, { title });
  await page.goto("/");
  const chip = page.locator(".assistant-message-token");
  await expect(chip).toHaveCount(2);
  await expect(chip.nth(0)).toHaveText("Larimar: Large Langu…");
  await expect(chip.nth(0)).toHaveAttribute("title", title);
  await expect(chip.nth(1)).toHaveText("Cicada");
  expect((await chip.nth(1).boundingBox())!.width).toBeLessThan(90);
  const messages = (await page.locator(".assistant-messages").boundingBox())!;
  const reply = (await page.locator(".assistant-message.assistant").boundingBox())!;
  expect(reply.x - messages.x).toBeGreaterThanOrEqual(12);
  expect(messages.x + messages.width - reply.x - reply.width).toBeGreaterThanOrEqual(12);
  await page.screenshot({ path: testInfo.outputPath("chat-gutter.png") });
});
