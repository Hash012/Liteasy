import { expect, test } from "@playwright/test";

test("offline board persists references, relations, keyboard movement and context after reopening", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await page
    .getByRole("button", { name: "切换或新建白板", exact: true })
    .click();
  await page.getByLabel("新白板名称", { exact: true }).fill("方法与证据");
  await page.getByRole("button", { name: "新建白板", exact: true }).click();
  await page.getByRole("button", { name: "添加笔记", exact: true }).click();
  for (const [index, text] of [
    "方法 A：稀疏表示减少存储成本，需要比较检索质量。",
    "方法 B：长尾查询需要额外的语义召回。",
  ].entries()) {
    await page.getByLabel("笔记内容", { exact: true }).fill(text);
    await page.getByRole("button", { name: "新建笔记", exact: true }).click();
    await expect(page.locator(".object-placement")).toHaveCount(index + 1);
    await expect(page.getByLabel("笔记内容", { exact: true })).toHaveValue("");
  }
  const cards = page.locator(".object-placement");
  await page.getByRole("button", { name: "收起工具", exact: true }).click();
  for (const card of [cards.nth(0), cards.nth(1)]) {
    await card.click({ button: "right" });
    await page.getByRole("menuitem", { name: "选择卡片", exact: true }).click();
  }
  await page.getByRole("button", { name: "连接内容", exact: true }).click();
  await page.getByRole("button", { name: "建立引用", exact: true }).click();
  await expect(page.locator(".object-board-edges text")).toHaveText("引用");
  const before = await cards.first().boundingBox();
  await cards.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动卡片", exact: true }).click();
  await cards.first().press("ArrowDown");
  await cards.first().press("Escape");
  await expect
    .poll(async () => (await cards.first().boundingBox())!.y)
    .toBeGreaterThan(before!.y + 10);
  await page.getByRole("button", { name: "询问所选内容", exact: true }).click();
  await page
    .getByRole("button", { name: "查看实际发送内容", exact: true })
    .click();
  await expect(page.locator(".object-context pre")).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("research-board-context.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.locator(".object-board-edges text")).toHaveText("引用");
  await cards.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "移除卡片", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "已保存的内容", exact: true }).click();
  await expect(page.locator(".object-library > div")).toHaveCount(2);
});

test("PDF drag captures a real document fragment and preserves its source after reload", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const pdf = await readFile(
    new URL(
      "../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf",
      import.meta.url,
    ),
  );
  await page.route("**/manual-preview/das24a.pdf", (route) =>
    route.fulfill({ body: pdf, contentType: "application/pdf" }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(
    page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer'),
  ).not.toBeEmpty({ timeout: 30000 });
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  const span = page
    .locator('.pdf-page-shell[data-page="1"] .pdf-text-layer span')
    .filter({ hasText: /\S{4}/ })
    .first();
  const bounds = (await span.boundingBox())!;
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  const handle = page
    .locator(".pdf-selection-menu")
    .getByRole("button", { name: "加入白板", exact: true });
  await expect(handle).toBeVisible();
  await handle.dragTo(page.getByLabel("白板卡片区域", { exact: true }));
  await expect(page.locator(".object-placement")).toHaveCount(1);
  await expect(page.locator(".object-placement")).toHaveAttribute(
    "aria-label",
    /第 1 页/,
  );
  await page.reload();
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(page.locator(".object-placement")).toHaveCount(1);
  await page.locator(".object-placement").click({ button: "right" });
  await page.getByRole("menuitem", { name: "查看来源", exact: true }).click();
  await expect(page.getByLabel("内容详情", { exact: true })).toContainText(
    "das24a.pdf",
  );
});

test("a saved answer can be dragged into the board without a new model call", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "liteasy.assistant-history.v1",
      JSON.stringify({
        version: "liteasy.assistant-history/v1",
        activeSessionId: "saved-answer-fixture",
        sessions: [
          {
            id: "saved-answer-fixture",
            title: "Saved answer fixture",
            mode: "qa",
            status: "completed",
            messages: [
              {
                id: "answer-fixture",
                role: "assistant",
                content: "This saved answer explains a research method.",
              },
            ],
          },
        ],
        draft: { input: "", tokens: [], readerContexts: [] },
      }),
    );
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const answer = page.getByRole("article", { name: "AI 回复", exact: true });
  await expect(answer).toContainText("This saved answer");
  await answer.hover();
  await answer.getByRole("button", { name: "加入白板", exact: true }).click();
  await expect(page.locator(".object-placement")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭白板", exact: true }).click();
  await answer.hover();
  const drag = answer.getByRole("button", { name: "加入白板", exact: true });
  // The drag adapter reveals the destination after the host has started the drag.
  const box = (await drag.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 15, { steps: 8 });
  await expect(page.getByLabel("白板卡片区域", { exact: true })).toBeVisible();
  const target = (await page
    .getByLabel("白板卡片区域", { exact: true })
    .boundingBox())!;
  await page.mouse.move(target.x + 100, target.y + 150, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".object-placement")).toHaveCount(2);
});
