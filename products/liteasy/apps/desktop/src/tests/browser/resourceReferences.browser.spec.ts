import { expect, test } from "@playwright/test";

test("wiki authoring shares the AI picker, persists source syntax, previews fragments and embeds them", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ ...JSON.parse(localStorage.getItem("liteasy.view-settings.v1") ?? "{}"), "view.markdown_mode": "manual" }));
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Reference Vault", { create: true });
      for (const [name, text] of [["CicN.md", "# CicN\nintro\n## Title1\nfirst evidence\n### Detail\nsecond evidence\n## Title2\nnot selected"], ["index.md", "# Research\n"]]) {
        const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
        await writable.write(text); await writable.close();
      }
      return directory;
    } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  await notes.getByRole("treeitem", { name: "extern/Reference Vault", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 index.md", exact: true }).dblclick();
  const workspace = page.getByRole("region", { name: "Markdown 文件阅读与编辑" });
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = workspace.getByRole("textbox", { name: "Markdown 源码" });
  await editor.press("Control+End");
  await editor.pressSequentially("[[");
  await expect(editor).toHaveValue("# Research\n[[]]");
  const field = page.getByRole("textbox", { name: "引用的文件或论文" });
  await expect(field).toBeFocused();
  await field.fill("CicN");
  await page.getByRole("button", { name: "Title1 L3–6", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("wiki-section-picker.png"), animations: "disabled" });
  await page.getByRole("button", { name: "插入引用", exact: true }).click();
  await expect(editor).toHaveValue("# Research\n[[CicN#Title1]]");
  await expect(editor).toBeFocused();
  await editor.press("Control+z");
  await expect(editor).toHaveValue("# Research\n[[CicN]]");
  await editor.press("Control+y");
  await editor.press("Control+End");
  await editor.press("Enter");
  await workspace.getByRole("button", { name: "插入文件引用", exact: true }).click();
  await page.getByRole("button", { name: "浏览文件并选择引用内容", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "上下文资产浏览器" });
  await browser.getByRole("button", { name: "预览 CicN.md", exact: true }).click();
  await browser.getByRole("button", { name: "选择第 4 行", exact: true }).click();
  await browser.getByRole("button", { name: "选择第 6 行", exact: true }).click({ modifiers: ["Shift"] });
  await browser.getByRole("button", { name: "插入选中片段引用", exact: true }).click();
  await expect(editor).toHaveValue("# Research\n[[CicN#Title1]]\n[[CicN#L4:6]]");
  await editor.press("Control+End");
  await editor.press("Enter");
  await page.keyboard.insertText("![[CicN#L4:4]]");
  await workspace.getByRole("button", { name: "保存", exact: true }).click();
  // The OPFS File snapshot becomes unreadable if the asynchronous writer commits
  // after getFile(). Wait for the application's completed save before inspecting it.
  await expect(workspace.getByRole("status")).toContainText("已保存到原文件");
  const persisted = () => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Reference Vault");
    return (await (await directory.getFileHandle("index.md")).getFile()).text();
  });
  await expect.poll(persisted).toContain("[[CicN#L4:6]]\n![[CicN#L4:4]]");
  await workspace.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(workspace.getByText("first evidence", { exact: true })).toBeVisible();
  await workspace.getByRole("link", { name: "CicN#Title1", exact: true }).hover();
  const preview = page.getByLabel("引用内容预览", { exact: true });
  await expect(preview.getByText("second evidence", { exact: true })).toBeVisible();
  await expect(preview.getByText("not selected", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("wiki-hover-preview.png"), animations: "disabled" });
  await preview.getByRole("button", { name: "关闭引用预览" }).click();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await browser.getByRole("button", { name: "预览 CicN.md", exact: true }).click();
  await browser.getByRole("button", { name: "打开内容，选择章节或文字" }).click();
  await browser.getByRole("button", { name: "Title1 L3–6", exact: true }).click();
  await browser.getByRole("button", { name: "将选中片段加入对话", exact: true }).click();
  await expect(page.getByRole("button", { name: /移除上下文：CicN.md · Title1/ })).toBeVisible();
});
