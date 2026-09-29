import { expect, test } from "@playwright/test";

test("Obsidian Canvas retains groups and media references while moving contained cards and saving edits", async ({ page }, info) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => {
      const file = await (await navigator.storage.getDirectory()).getFileHandle("Interop.canvas", { create: true });
      const writer = await file.createWritable();
      await writer.write(JSON.stringify({ custom: { retained: true }, nodes: [
        { id: "group", type: "group", label: "研究流程", x: 0, y: 0, width: 740, height: 440, color: "5" },
        { id: "a", type: "text", text: "## Physical World\n\n观察与研究问题", x: 40, y: 50, width: 280, height: 120 },
        { id: "b", type: "text", text: "## Raw Data\n\n可追溯的研究材料", x: 400, y: 240, width: 280, height: 120, color: "6" },
        { id: "image", type: "file", file: "assets/figure.png", x: 40, y: 240, width: 240, height: 120 },
      ], edges: [{ id: "ab", fromNode: "a", toNode: "b", fromSide: "right", toSide: "top", color: "5", label: "分析" }] }));
      await writer.close();
      return [file];
    } });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  const board = page.locator("section.object-workbench");
  await board.getByRole("button", { name: "打开白板文件", exact: true }).click();
  const group = board.locator('.object-placement[data-placement-id="group"]');
  await expect(group).toHaveClass(/is-group/);
  await expect(board.locator(".object-file-reference")).toContainText("figure.png");
  await board.getByRole("button", { name: "适配全部卡片", exact: true }).click();
  await group.getByRole("button", { name: "编辑笔记正文" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动卡片", exact: true }).click();
  await expect(group).toBeFocused();
  await group.press("ArrowRight");
  await expect(board.locator('[data-placement-id="a"]')).toHaveCSS("left", "60px");
  await group.press("Escape");
  const card = board.locator('[data-placement-id="a"]');
  await card.click();
  await expect(card.getByRole("toolbar", { name: "选中卡片操作" })).toBeVisible();
  await card.getByRole("button", { name: "编辑内容", exact: true }).click();
  await card.getByRole("textbox", { name: "编辑卡片正文" }).fill("## Physical World\n\n在 Liteasy 完成修改");
  await card.getByRole("button", { name: "保存修改", exact: true }).click();
  const saved = () => page.evaluate(async () => JSON.parse(await (await (await (await navigator.storage.getDirectory()).getFileHandle("Interop.canvas")).getFile()).text()));
  await expect.poll(async () => (await saved()).nodes.find((node: { id: string }) => node.id === "a").text).toContain("在 Liteasy 完成修改");
  const document = await saved();
  expect(document.nodes.find((node: { id: string }) => node.id === "group")).toMatchObject({ type: "group", label: "研究流程", x: 20 });
  expect(document.nodes.find((node: { id: string }) => node.id === "image")).toMatchObject({ type: "file", file: "assets/figure.png", x: 60 });
  expect(document.edges[0]).toMatchObject({ color: "5", label: "分析" });
  expect(document.custom.retained).toBe(true);
  await page.evaluate(async () => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle("Interop.canvas");
    const value = JSON.parse(await (await file.getFile()).text());
    value.nodes.find((node: { id: string }) => node.id === "b").text = "在 Obsidian 中更新的材料";
    const writer = await file.createWritable(); await writer.write(JSON.stringify(value)); await writer.close();
    window.dispatchEvent(new Event("focus"));
  });
  await expect(board.locator('[data-placement-id="b"]')).toContainText("在 Obsidian 中更新的材料");
  await page.screenshot({ path: info.outputPath("canvas-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => board.evaluate((element) => getComputedStyle(element).getPropertyValue("--colorBrandBackground2").trim())).toBe("#082338");
  await page.screenshot({ path: info.outputPath("canvas-dark.png"), fullPage: true });
});

test("Notes preserves a nested Vault tree and customized icons across reload", async ({ page }, info) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const vault = await (await navigator.storage.getDirectory()).getDirectoryHandle("Research Vault", { create: true });
      const parent = await vault.getDirectoryHandle("CSLife", { create: true });
      const child = await parent.getDirectoryHandle("Dev-Design", { create: true });
      const file = await child.getFileHandle("Research.md", { create: true });
      const writer = await file.createWritable(); await writer.write("# Research\n笔记正文"); await writer.close();
      return vault;
    } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  const tree = notes.getByRole("tree", { name: "笔记文件夹" });
  await expect(tree.getByRole("treeitem", { name: "extern/Research Vault/CSLife", exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "extern/Research Vault/CSLife/Dev-Design", exact: true })).toHaveCount(0);
  await tree.getByRole("button", { name: "展开 CSLife", exact: true }).click();
  const child = tree.getByRole("treeitem", { name: "extern/Research Vault/CSLife/Dev-Design", exact: true });
  await child.click();
  const file = notes.getByRole("button", { name: "查看笔记 Research.md", exact: true });
  await expect(file).toBeVisible();
  await notes.getByRole("button", { name: "笔记操作 Research.md" }).click();
  await page.getByRole("menuitem", { name: "更换图标", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "实验 科学", exact: true }).click();
  await expect(file.locator('[data-icon="science"]')).toBeVisible();
  await page.reload();
  await tree.getByRole("button", { name: "展开 Research Vault", exact: true }).click();
  await tree.getByRole("button", { name: "展开 CSLife", exact: true }).click();
  await child.click();
  await expect(file.locator('[data-icon="science"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath("notes-tree-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => notes.evaluate((element) => getComputedStyle(element).getPropertyValue("--colorBrandBackground2").trim())).toBe("#082338");
  await page.screenshot({ path: info.outputPath("notes-tree-dark.png"), fullPage: true });
});
