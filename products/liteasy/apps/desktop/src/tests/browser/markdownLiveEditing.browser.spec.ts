import { expect, test } from "@playwright/test";

test("live Markdown renders in place, autosaves, preserves concurrent writes and can switch back to manual", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Live Vault", { create: true });
      const writer = await (await directory.getFileHandle("research.md", { create: true })).createWritable();
      await writer.write("# Research\n\nFirst **strong** paragraph.\n\n$$x^2$$\n\n## Notes\n\nLast paragraph."); await writer.close();
      return directory;
    } });
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  await notes.getByRole("treeitem", { name: "extern/Live Vault", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 research.md", exact: true }).dblclick();
  const workspace = page.getByRole("region", { name: "Markdown 文件阅读与编辑" });
  await expect(workspace.getByRole("heading", { name: "Research", exact: true })).toBeVisible();
  await expect(workspace.locator(".katex")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  const editor = workspace.getByRole("textbox", { name: "Markdown 正文", exact: true });
  await editor.focus(); await editor.press("Control+End"); await page.keyboard.insertText(" Auto saved.");
  const read = () => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Live Vault");
    return (await (await directory.getFileHandle("research.md")).getFile()).text();
  });
  await expect.poll(read).toContain("Last paragraph. Auto saved.");
  await editor.press("Enter"); await editor.pressSequentially("[[");
  await expect(page.getByRole("textbox", { name: "引用的文件或论文" })).toBeFocused();
  await page.keyboard.press("Escape");
  await editor.focus(); await editor.press("Control+z");
  await workspace.screenshot({ path: testInfo.outputPath("live-markdown.png"), animations: "disabled" });
  await editor.press("Control+End"); await page.keyboard.insertText(" local draft");
  await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Live Vault");
    const writer = await (await directory.getFileHandle("research.md")).createWritable();
    await writer.write("External editor changed this file"); await writer.close();
  });
  await expect(workspace.getByRole("alert")).toContainText("其他应用");
  expect(await read()).toBe("External editor changed this file");
  await expect(editor).toContainText("local draft");
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "应用设置" });
  await settings.getByRole("button", { name: "外观与阅读" }).click();
  await settings.getByRole("radio", { name: "手动切换 · 编辑、保存、阅读" }).check();
  await page.getByRole("button", { name: "关闭 设置", exact: true }).click();
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(workspace.getByRole("textbox", { name: "Markdown 源码" })).toHaveValue(/local draft/);
  expect(errors).toEqual([]);
});

test("live note blocks keep source Markdown, full-document selection and viewport-bounded rendering", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Long Vault", { create: true });
      const writer = await (await directory.getFileHandle("long.md", { create: true })).createWritable();
      await writer.write(Array.from({ length: 700 }, (_, n) => `## Section ${n}\n\nText **${n}** [reference][site].`).join("\n\n") + "\n\n[site]: https://example.com"); await writer.close(); return directory;
    } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  await notes.getByRole("treeitem", { name: "extern/Long Vault", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 long.md", exact: true }).dblclick();
  const workspace = page.getByRole("region", { name: "Markdown 文件阅读与编辑" });
  await expect(workspace.getByRole("heading", { name: "Section 0", exact: true })).toBeVisible();
  await expect(workspace.getByRole("link", { name: "reference", exact: true }).first()).toHaveAttribute("href", "https://example.com");
  expect(await workspace.locator(".markdown-live-preview").count()).toBeLessThan(100);
  const editor = workspace.getByRole("textbox", { name: "Markdown 正文" });
  await editor.focus(); await editor.press("Control+End");
  await expect.poll(() => workspace.locator(".cm-scroller").evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  expect(await workspace.locator(".markdown-live-preview").count()).toBeLessThan(100);
  await editor.press("Control+a"); await page.keyboard.insertText("# Replaced\n\nSaved **whole** document.");
  await expect.poll(() => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Long Vault");
    return (await (await directory.getFileHandle("long.md")).getFile()).text();
  })).toBe("# Replaced\n\nSaved **whole** document.");
});

test("a saved note in the notes panel can be edited inline and reopened after autosave", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "新建笔记", exact: true }).click();
  await notes.getByRole("textbox", { name: "笔记正文" }).fill("Inline note\n\nOriginal content.");
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  const detail = notes.getByRole("region", { name: "打开的笔记" });
  const editor = detail.getByRole("textbox", { name: "笔记正文" });
  await editor.focus(); await editor.press("Control+End"); await page.keyboard.insertText(" First edit.");
  await expect(detail.getByRole("status")).toHaveText("已保存");
  await editor.press("Control+End"); await page.keyboard.insertText(" Second edit.");
  await expect(detail.getByRole("status")).toHaveText("已保存");
  // Rebuild the editor from the persisted asset, not its local state.
  await notes.getByRole("treeitem", { name: "extern", exact: true }).click();
  await notes.getByRole("treeitem", { name: "Liteasy/个人笔记", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 Inline note", exact: true }).click();
  await expect(detail).toContainText("Original content. First edit. Second edit.");
  await expect(detail.getByRole("alert")).toHaveCount(0);
});
