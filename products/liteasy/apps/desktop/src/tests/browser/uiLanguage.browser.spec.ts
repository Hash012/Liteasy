import { expect, test } from "@playwright/test";

test("switches core UI without losing Markdown, chat, font or settings drafts", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.language": "zh-CN", "view.markdown_mode": "manual" }));
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Language Vault", { create: true });
      const writer = await (await directory.getFileHandle("research.md", { create: true })).createWritable();
      await writer.write("# Research\n\nOriginal content."); await writer.close();
      return directory;
    } });
  });
  const errors: string[] = [];
  const modelRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (/\/(chat\/completions|responses|messages|agent\/turns)(?:\?|$)/.test(request.url())) modelRequests.push(request.url());
  });
  await page.goto("/");
  const chat = page.locator("textarea.assistant-input");
  await chat.fill("尚未发送的研究问题");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  await notes.getByRole("treeitem", { name: "extern/Language Vault", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 research.md", exact: true }).dblclick();
  const workspace = page.getByRole("region", { name: "Markdown 文件阅读与编辑" });
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = workspace.getByRole("textbox", { name: "Markdown 源码" });
  await editor.fill("# Research\n\n未保存的笔记 draft.");
  await page.keyboard.press("Control+,");
  const settings = page.locator(".settings-page");
  await settings.getByRole("button", { name: "AI 与助手" }).click();
  await settings.getByLabel("AI 接入方式").selectOption("direct");
  await settings.getByLabel("模型 ID", { exact: true }).fill("unfinished-model");
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  await settings.getByRole("combobox", { name: "界面中文字体" }).fill("Unfinished Font");
  await settings.getByRole("combobox", { name: "界面语言" }).selectOption("en-US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("navigation", { name: "Sidebar navigation" })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Chinese interface font" })).toHaveValue("Unfinished Font");
  await expect(chat).toHaveValue("尚未发送的研究问题");
  await settings.getByRole("button", { name: "AI and assistant", exact: true }).click();
  await expect(settings.getByLabel("模型 ID", { exact: true })).toHaveValue("unfinished-model");
  await settings.getByRole("textbox", { name: "Search settings" }).fill("language");
  await expect(settings.getByRole("combobox", { name: "Display language" })).toBeVisible();
  await settings.getByRole("button", { name: "Clear settings search" }).click();
  await settings.getByRole("button", { name: "Appearance and reading", exact: true }).click();
  await settings.screenshot({ path: testInfo.outputPath("settings-english.png") });
  await settings.getByRole("combobox", { name: "Display language" }).selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "关闭 设置", exact: true }).click();
  await expect(editor).toHaveValue("# Research\n\n未保存的笔记 draft.");
  await expect(chat).toHaveValue("尚未发送的研究问题");
  expect(modelRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe("system language", () => {
  test.use({ locale: "en-GB", deviceScaleFactor: 1.5 });
  test("follows system on first launch and persists an explicit language on reload", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1050, height: 780 });
    await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await page.getByRole("navigation", { name: "Sidebar navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.locator(".settings-page");
    const language = settings.getByRole("combobox", { name: "Display language" });
    await expect(language).toHaveValue("system");
    expect(await settings.locator(".settings-content").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath("settings-english-narrow-150.png") });
    await language.selectOption("zh-CN");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("navigation", { name: "左边栏导航" })).toBeVisible();
    await page.keyboard.press("Control+,");
    await expect(settings.getByRole("combobox", { name: "界面语言" })).toHaveValue("zh-CN");
  });
});


test("keeps the current PDF page when switching display language", async ({ page }) => {
  test.setTimeout(60000);
  const content = "BT /F1 18 Tf 40 240 Td (Abstract: Language switching.) Tj ET";
  const leaf = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] /Count 3 >>", leaf,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, leaf, leaf];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = source.length; source += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = source.length;
  source += `xref\n0 8\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdf = Buffer.from(source);
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/?pdf-highlight-fixture#language");
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).not.toBeEmpty();
  const currentPage = page.getByLabel("当前页码");
  await currentPage.fill("3");
  await currentPage.press("Enter");
  await expect(page.locator('.pdf-page-shell[data-page="3"] .pdf-text-layer')).not.toBeEmpty();
  await expect(currentPage).toHaveValue("3");
  await page.keyboard.press("Control+,");
  await page.getByRole("combobox", { name: "界面语言" }).selectOption("en-US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await page.getByRole("button", { name: "关闭 设置", exact: true }).click();
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  await expect(currentPage).toHaveValue("3");
  await expect(page.locator('.pdf-page-shell[data-page="3"] .pdf-text-layer')).not.toBeEmpty();
});
