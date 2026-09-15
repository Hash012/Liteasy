import { expect, test } from "@playwright/test";

test("dropping a note into a connected Vault writes Markdown and protects subsequent external edits", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  // Only the OS directory chooser is replaced. Handles, IndexedDB, Markdown
  // writes, reload, and competing file edits use Chromium's real filesystem.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true,
      value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle("Research Vault", { create: true }) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "新建笔记", exact: true }).click();
  await notes.getByRole("textbox", { name: "笔记正文" }).fill("Vault sample\n\n用户的研究记录。\n\n## AI review\n保留对照实验。");
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  const vault = notes.getByRole("button", { name: "Research Vault", exact: true });
  await expect(vault).toBeVisible();
  await notes.getByRole("button", { name: "default/note", exact: true }).click();
  await notes.getByRole("button", { name: "查看笔记 Vault sample", exact: true }).dragTo(vault);
  const readFile = () => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Research Vault");
    return (await (await directory.getFileHandle("Vault sample.md")).getFile()).text();
  });
  await expect.poll(readFile).toContain("保留对照实验。");
  await vault.click();
  const file = notes.getByRole("button", { name: "查看笔记 Vault sample.md", exact: true });
  await expect(file).toBeVisible();
  await page.reload();
  await vault.click();
  await file.click();
  await notes.getByRole("button", { name: "编辑笔记", exact: true }).click();
  const editor = notes.getByRole("textbox", { name: "笔记正文" });
  await editor.fill("Liteasy 尚未保存的编辑");
  await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Research Vault");
    const writable = await (await directory.getFileHandle("Vault sample.md")).createWritable();
    await writable.write("Obsidian 中刚保存的内容"); await writable.close();
  });
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  await expect(notes.getByRole("alert")).toContainText("其他应用");
  await expect(editor).toHaveValue("Liteasy 尚未保存的编辑");
  expect(await readFile()).toBe("Obsidian 中刚保存的内容");
  await page.screenshot({ path: testInfo.outputPath("vault-file-conflict.png"), fullPage: true, animations: "disabled" });
});
