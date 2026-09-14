import { expect, test } from "@playwright/test";

test("board closes from details, notes edit in place, every resize handle works, and saved notes drag back", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await page.getByRole("button", { name: "添加笔记", exact: true }).click();
  await page.getByLabel("笔记内容", { exact: true }).fill("单击编辑的研究笔记");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByRole("button", { name: "收起工具", exact: true }).click();
  const board = page.locator("section.object-workbench");
  const card = board.locator(".object-placement").first();
  await expect(card).toContainText("单击编辑的研究笔记");
  await card.getByRole("button", { name: "编辑笔记正文", exact: true }).click();
  const editor = card.getByRole("textbox", {
    name: "编辑卡片正文",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.fill("通过单击直接编辑后的笔记");
  await editor.press("Control+Enter");
  await expect(card.locator(".object-body")).toContainText(
    "通过单击直接编辑后的笔记",
  );
  await expect(card.getByRole("button", { name: /^调整卡片大小/ })).toHaveCount(
    0,
  );
  await card.getByRole("button", { name: "编辑笔记正文", exact: true }).click();
  const original = (await card.boundingBox())!;
  const edge = card.getByRole("button", {
    name: "调整卡片大小：右下角",
    exact: true,
  });
  const edgeBounds = (await edge.boundingBox())!;
  await page.mouse.move(
    edgeBounds.x + edgeBounds.width / 2,
    edgeBounds.y + edgeBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    edgeBounds.x + edgeBounds.width / 2 + 55,
    edgeBounds.y + edgeBounds.height / 2 + 80,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await card.boundingBox())!.width)
    .toBeGreaterThan(original.width + 45);
  await expect
    .poll(async () => (await card.boundingBox())!.height)
    .toBeGreaterThan(original.height + 70);
  // Every side/corner is keyboard reachable as well as pointer draggable.
  for (const [label, key] of [
    ["上边", "ArrowDown"],
    ["右上角", "ArrowDown"],
    ["右边", "ArrowLeft"],
    ["下边", "ArrowUp"],
    ["左下角", "ArrowUp"],
    ["左边", "ArrowRight"],
    ["左上角", "ArrowRight"],
  ]) {
    const before = await card.getAttribute("style");
    await card
      .getByRole("button", { name: `调整卡片大小：${label}`, exact: true })
      .press(key);
    await expect.poll(() => card.getAttribute("style")).not.toBe(before);
  }
  const resizedStyle = await card.getAttribute("style");
  await card.getByRole("button", { name: "取消编辑", exact: true }).click();
  await card.press("Shift+F10");
  await page.getByRole("menuitem", { name: "关联与历史", exact: true }).click();
  await expect(board.getByLabel("内容详情", { exact: true })).toBeVisible();
  await board.getByRole("button", { name: "关闭白板", exact: true }).click();
  await expect(board).not.toBeVisible();
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(board.getByLabel("内容详情", { exact: true })).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(card.locator(".object-body")).toContainText(
    "通过单击直接编辑后的笔记",
  );
  await expect(card).toHaveAttribute("style", resizedStyle!);
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "移除卡片", exact: true }).click();
  await expect(board.locator(".object-placement")).toHaveCount(0);
  await board
    .getByRole("button", { name: "已保存的内容", exact: true })
    .click();
  const dragHandle = board
    .locator(".object-library")
    .getByRole("button", { name: /^拖动/ })
    .first();
  await dragHandle.dragTo(board.getByLabel("白板卡片区域", { exact: true }));
  await expect(card.locator(".object-body")).toContainText(
    "通过单击直接编辑后的笔记",
  );
  await board.getByRole("button", { name: "收起工具", exact: true }).click();
  await expect(board.locator(".object-tool-panel")).toHaveCount(0);
  await expect(card.locator(".object-meta")).toHaveCount(0);
  const beforeZoom = (await card.boundingBox())!;
  await board.getByRole("button", { name: "缩小画布", exact: true }).click();
  await expect
    .poll(async () => (await card.boundingBox())!.width)
    .toBeLessThan(beforeZoom.width);
  await expect(
    board.getByRole("button", { name: "重置画布缩放", exact: true }),
  ).toHaveText("90%");
  await board
    .getByRole("toolbar", { name: "画布视图", exact: true })
    .getByRole("button", { name: "适配全部卡片", exact: true })
    .click();
  const canvasBounds = (await board
    .getByLabel("白板卡片区域", { exact: true })
    .boundingBox())!;
  await expect
    .poll(async () => {
      const bounds = (await card.boundingBox())!;
      return (
        bounds.x >= canvasBounds.x &&
        bounds.x + bounds.width <= canvasBounds.x + canvasBounds.width
      );
    })
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("board.png"),
    fullPage: true,
  });
  await card.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "调整卡片大小", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("board-menu.png"),
    fullPage: true,
    animations: "disabled",
  });
});
