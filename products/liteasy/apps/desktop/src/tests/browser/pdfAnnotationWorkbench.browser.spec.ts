import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("PDF annotation rows use compact icon metadata and reveal labeled actions on selection", async ({
  page,
}, testInfo) => {
  const pdf = await readFile(
    new URL(
      "../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf",
      import.meta.url,
    ),
  );
  await page.route("**/manual-preview/das24a.pdf", (route) =>
    route.fulfill({ body: pdf, contentType: "application/pdf" }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?pdf-highlight-fixture#importable");
  const paper = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(paper.locator(".pdf-text-layer")).not.toBeEmpty({
    timeout: 30_000,
  });
  const span = paper
    .locator(".pdf-text-layer span")
    .filter({ hasText: /\S{4}/ })
    .first();
  const bounds = (await span.boundingBox())!;
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await page
    .getByLabel("选中文本批注菜单")
    .getByRole("button", { name: "高亮", exact: true })
    .click();
  const row = page.locator(".pdf-annotation-item.highlight");
  const summary = row.locator(".pdf-annotation-summary");
  await expect(row.getByRole("toolbar")).toHaveCount(0);
  await expect(summary).not.toContainText("未公开到论坛");
  await expect(summary).not.toContainText("第 1 页");
  await expect(
    summary.getByRole("img", { name: "高亮", exact: true }),
  ).toBeVisible();
  await summary.click();
  await row.getByLabel("补充批注笔记").fill("需要结合实验设置理解这一结论。");
  await row.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(summary).toContainText("需要结合实验设置理解这一结论。");
  await expect(row.getByRole("toolbar")).toHaveCount(0);
  await summary.click();
  await expect(
    row.getByRole("button", { name: "删除", exact: true }),
  ).toHaveText("");
  await expect(
    row.getByRole("checkbox", { name: /公开到论坛/ }),
  ).not.toBeChecked();
  await row.getByRole("status", { name: "未公开到论坛", exact: true }).hover();
  await expect(
    page.getByRole("tooltip", { name: "未公开到论坛", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("annotations.png"),
    fullPage: true,
  });
  await row.getByRole("button", { name: "收起批注操作", exact: true }).click();
  await expect(row.getByRole("toolbar")).toHaveCount(0);
});

test("PDF drawing groups, resizable notes and annotation transfers survive reopening", async ({
  page,
}, testInfo) => {
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
  const paper = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(paper.locator(".pdf-text-layer")).not.toBeEmpty({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "手绘涂鸦", exact: true }).click();
  const inkLayer = paper.getByLabel("PDF 手绘图层");
  async function draw(x: number, y: number) {
    const bounds = (await inkLayer.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * (x + 0.04),
      bounds.y + bounds.height * (y + 0.02),
      { steps: 8 },
    );
    await page.mouse.up();
  }
  await draw(0.25, 0.32);
  await draw(0.29, 0.34);
  await expect(inkLayer.getByLabel("手绘笔迹")).toHaveCount(2);
  await expect(page.locator(".pdf-annotation-item.ink")).toHaveCount(1);
  await draw(0.6, 0.55);
  await expect(page.locator(".pdf-annotation-item.ink")).toHaveCount(2);
  await page.getByRole("button", { name: "完成手绘", exact: true }).click();
  await page
    .getByRole("button", { name: "在 PDF 中添加 Markdown 文本框", exact: true })
    .click();
  const paperBounds = (await paper.boundingBox())!;
  await page.mouse.click(
    paperBounds.x + paperBounds.width * 0.4,
    paperBounds.y + paperBounds.height * 0.42,
  );
  const box = paper.getByRole("region", { name: "Markdown 文本框：第 1 页" });
  await page
    .getByRole("textbox", { name: "编辑第 1 页 Markdown 文本框" })
    .fill("可拖动的研究笔记");
  await page
    .getByRole("button", { name: "保存 Markdown 文本框", exact: true })
    .click();
  await box.click();
  await expect(
    page.getByRole("textbox", { name: "编辑第 1 页 Markdown 文本框" }),
  ).toBeVisible();
  const initial = (await box.boundingBox())!;
  const corner = (await box
    .getByRole("button", { name: "调整 Markdown 文本框右下角", exact: true })
    .boundingBox())!;
  await page.mouse.move(
    corner.x + corner.width / 2,
    corner.y + corner.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    corner.x + corner.width / 2 + 90,
    corner.y + corner.height / 2 + 45,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await box.boundingBox())!.width)
    .toBeGreaterThan(initial.width + 75);
  await expect
    .poll(async () => (await box.boundingBox())!.height)
    .toBeGreaterThan(initial.height + 35);
  await page
    .getByRole("button", { name: "保存 Markdown 文本框", exact: true })
    .click();
  const savedWidth = await box.evaluate(
    (element) => (element as HTMLElement).style.width,
  );
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  const board = page.getByLabel("白板卡片区域", { exact: true });
  await page
    .locator(".pdf-annotation-item.text")
    .locator(".pdf-annotation-summary")
    .dragTo(board);
  await expect(page.locator(".object-placement")).toHaveCount(1);
  await expect(page.locator(".object-placement")).toContainText(
    "可拖动的研究笔记",
  );
  await page
    .locator(".pdf-annotation-item.ink")
    .first()
    .locator(".pdf-annotation-summary")
    .dragTo(board);
  await expect(page.locator(".object-placement")).toHaveCount(2);
  await expect(page.locator(".object-placement img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "关闭 PDF 白板", exact: true })
    .click();
  await expect(board).toHaveCount(0);
  await expect(page.getByLabel("PDF 阅读工作区")).not.toHaveClass(
    /whiteboard-open/,
  );
  await page.reload();
  await expect(paper.getByLabel("手绘笔迹")).toHaveCount(3);
  await expect(page.locator(".pdf-annotation-item.ink")).toHaveCount(2);
  await expect
    .poll(async () =>
      box.evaluate((element) => (element as HTMLElement).style.width),
    )
    .toBe(savedWidth);
  await expect(box).toContainText("可拖动的研究笔记");
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(page.locator(".object-placement")).toHaveCount(2);
  await expect(paper.locator(".pdf-text-layer")).not.toBeEmpty();
  const drawing = page.locator(".object-placement img");
  await expect(drawing).toBeVisible();
  await expect
    .poll(() =>
      drawing.evaluate((element) => {
        const image = element as HTMLImageElement;
        return (
          image.complete &&
          image.naturalWidth > 0 &&
          image.getBoundingClientRect().height > 10
        );
      }),
    )
    .toBe(true);
  await page.mouse.move(1200, 950);
  await page.screenshot({
    path: testInfo.outputPath("pdf-annotation-workbench.png"),
    fullPage: true,
  });
});
