import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("Markdown import uses a real file chooser, lists filenames and persists editable content", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "左边栏导航" })
    .getByRole("button", { name: "笔记", exact: true })
    .click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  const chooser = page.waitForEvent("filechooser");
  await notes
    .getByRole("button", { name: "导入 Markdown 文件", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "Literature.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "---\ntags: [research]\n---\n# 文献梳理\n此正文只在打开文件后展示。\n\n## AI review\n注意证据边界。",
    ),
  });
  const entry = notes.getByRole("button", {
    name: "查看笔记 Literature.md",
    exact: true,
  });
  await expect(entry).toBeVisible();
  const list = notes.getByRole("list", { name: "笔记条目" });
  await expect(list).toContainText("Literature.md");
  await expect(list).not.toContainText("此正文只在打开文件后展示。");
  await entry.click();
  const preview = notes.getByRole("region", {
    name: "打开的笔记",
    exact: true,
  });
  await expect(preview).toContainText("注意证据边界。");
  await notes.getByRole("button", { name: "编辑笔记", exact: true }).click();
  await notes
    .getByRole("textbox", { name: "笔记正文", exact: true })
    .fill(
      "# 文献梳理\n修改后的 Markdown 正文。\n\n## AI review\n保留可编辑的 review。",
    );
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  await expect(entry).toBeVisible();
  await expect(preview).toContainText("修改后的 Markdown 正文。");
  await page.reload();
  await expect(entry).toBeVisible();
  await expect(list).not.toContainText("修改后的 Markdown 正文。");
  await entry.click();
  await expect(preview).toContainText("保留可编辑的 review。");
  await expect(notes.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("notes-markdown-import.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("a plain PDF highlight drags into Notes as a persisted entry reference", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const pdf = await readFile(
    new URL(
      "../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf",
      import.meta.url,
    ),
  );
  await page.route("**/manual-preview/das24a.pdf", (route) =>
    route.fulfill({ body: pdf, contentType: "application/pdf" }),
  );
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.goto("/?pdf-highlight-fixture#importable");
  const paper = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(paper.locator(".pdf-text-layer")).not.toBeEmpty({
    timeout: 30000,
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
  const summary = page.locator(".pdf-annotation-summary").first();
  const quote = await summary.locator(".pdf-annotation-excerpt").innerText();
  await page
    .getByRole("navigation", { name: "左边栏导航" })
    .getByRole("button", { name: "笔记", exact: true })
    .click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await expect(notes.getByRole("listitem")).toHaveCount(0);
  await summary.dragTo(notes.locator(".notes-content"));
  await expect(notes.getByRole("listitem")).toHaveCount(1);
  await notes.getByRole("button", { name: /^查看笔记 / }).click();
  await expect(notes.getByRole("region", { name: "打开的笔记" })).toContainText(
    quote,
  );
  await expect(page.locator("section.object-workbench")).toHaveCount(0);
  await page.reload();
  await expect(notes.getByRole("listitem")).toHaveCount(1);
  await notes.getByRole("button", { name: /^查看笔记 / }).click();
  await expect(notes.getByRole("region", { name: "打开的笔记" })).toContainText(
    quote,
  );
  await expect(notes.getByRole("alert")).toHaveCount(0);
  await expect(paper.locator(".pdf-text-layer")).not.toBeEmpty({
    timeout: 30000,
  });
  await page.screenshot({
    path: testInfo.outputPath("notes-highlight-drop.png"),
    fullPage: true,
    animations: "disabled",
  });
});
