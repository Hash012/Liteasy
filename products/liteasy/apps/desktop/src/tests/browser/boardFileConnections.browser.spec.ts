import { expect, test } from "@playwright/test";

test("card midpoint drag creates persistent connections without moving or opening the cards", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  const board = page.locator("section.object-workbench");
  await board.getByRole("button", { name: "添加笔记", exact: true }).click();
  for (const text of ["研究问题：量化误差", "论证与 AI review"]) {
    await board.getByLabel("笔记内容", { exact: true }).fill(text);
    await board.getByRole("button", { name: "新建笔记", exact: true }).click();
    await expect(
      board.locator(".object-placement").filter({ hasText: text }),
    ).toBeVisible();
  }
  await board.getByRole("button", { name: "收起工具", exact: true }).click();
  await board
    .getByRole("button", { name: "适配全部卡片", exact: true })
    .click();
  const cards = board.locator(".object-placement");
  const positions = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("style")),
  );
  const source = cards
    .filter({ hasText: "研究问题：量化误差" })
    .getByRole("button", { name: "连接卡片：右边", exact: true });
  const target = cards
    .filter({ hasText: "论证与 AI review" })
    .getByRole("button", { name: "连接卡片：左边", exact: true });
  await source.dragTo(target);
  await expect(
    board.locator(".object-board-edges g[data-edge-id]"),
  ).toHaveCount(1);
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("style")),
    ),
  ).toEqual(positions);
  await expect(
    board.getByRole("textbox", { name: "编辑卡片正文" }),
  ).toHaveCount(0);
  // The opposite outward-facing handles must route around both opaque cards.
  await cards.filter({ hasText: "论证与 AI review" }).getByRole("button", { name: "连接卡片：右边", exact: true })
    .dragTo(cards.filter({ hasText: "研究问题：量化误差" }).getByRole("button", { name: "连接卡片：左边", exact: true }));
  await expect(board.locator(".object-board-edges g[data-edge-id]")).toHaveCount(2);
  await expect.poll(async () => board.locator(".object-board-edges g[data-edge-id] > path").evaluateAll(paths =>
    paths.some(path => (path as SVGGraphicsElement).getBBox().height > 100))).toBe(true);
  await page.reload();
  await expect(
    board.locator(".object-board-edges g[data-edge-id]"),
  ).toHaveCount(2);
  await expect(
    board.getByRole("button", { name: "选择白板存储文件", exact: true }),
  ).toBeVisible();
  await board
    .getByRole("button", { name: "适配全部卡片", exact: true })
    .click();
  await cards.filter({ hasText: "研究问题：量化误差" }).hover();
  await page.screenshot({
    path: testInfo.outputPath("board-connections.png"),
    fullPage: true,
  });
  await board.getByRole("button", { name: "连接内容", exact: true }).click();
  await board.getByRole("button", { name: "移除连接", exact: true }).first().click();
  await expect(board.locator(".object-board-edges g[data-edge-id]")).toHaveCount(1);
  await board.getByRole("button", { name: "移除连接", exact: true }).click();
  await expect(
    board.locator(".object-board-edges g[data-edge-id]"),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    board.locator(".object-board-edges g[data-edge-id]"),
  ).toHaveCount(0);
});

test("a chosen Canvas file keeps real browser filesystem data and continues autosaving after reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  // Replace only the OS picker with a real origin-private filesystem handle.
  // FileSystemWritableFileStream, IndexedDB handle persistence and CAS remain real.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () =>
        (await navigator.storage.getDirectory()).getFileHandle("研究.canvas", {
          create: true,
        }),
    });
  });
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  const board = page.locator("section.object-workbench");
  await board.getByRole("button", { name: "添加笔记", exact: true }).click();
  await board.getByLabel("笔记内容", { exact: true }).fill("文件中的研究笔记");
  await board.getByRole("button", { name: "新建笔记", exact: true }).click();
  await expect(board.locator(".object-placement")).toHaveCount(1);
  await board.getByRole("button", { name: "收起工具", exact: true }).click();
  await board
    .getByRole("button", { name: "选择白板存储文件", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "保存白板文件", exact: true }),
  ).toBeEnabled();
  const contents = () =>
    page.evaluate(async () => {
      const handle = await (
        await navigator.storage.getDirectory()
      ).getFileHandle("研究.canvas");
      return (await handle.getFile()).text();
    });
  await expect.poll(contents).toContain("文件中的研究笔记");
  await page.reload();
  await expect(
    board.getByRole("button", { name: "保存白板文件", exact: true }),
  ).toBeVisible();
  await board
    .getByRole("button", { name: "编辑笔记正文", exact: true })
    .click();
  await board
    .getByRole("textbox", { name: "编辑卡片正文", exact: true })
    .fill("重启后自动保存的修改");
  await board.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(contents).toContain("重启后自动保存的修改");
  await board
    .getByRole("button", { name: "切换或新建白板", exact: true })
    .click();
  await expect(board.locator(".object-board-file-location")).toContainText(
    "研究.canvas",
  );
  await page.screenshot({
    path: testInfo.outputPath("board-file.png"),
    fullPage: true,
  });
});
