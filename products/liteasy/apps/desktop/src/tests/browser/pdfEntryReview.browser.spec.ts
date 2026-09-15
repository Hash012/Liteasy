import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("a stored PDF review remains editable after reload and follows its entry onto the board", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  testInfo.annotations.push({
    type: "fixture",
    description: "The initial model response is seeded in the annotation. This browser test verifies real UI editing, persistence and capture; public Agent generation is covered separately by unit integration tests.",
  });
  const pdf = await readFile(new URL(
    "../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url,
  ));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.addInitScript(() => localStorage.setItem("liteasy.pdf-sidebar-width", "330"));
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.goto("/?pdf-highlight-fixture#importable");
  const pdfPage = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(pdfPage.locator(".pdf-text-layer")).not.toBeEmpty({ timeout: 30_000 });
  const span = pdfPage.locator(".pdf-text-layer span").filter({ hasText: /\S{4}/ }).first();
  const bounds = (await span.boundingBox())!;
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.getByLabel("选中文本批注菜单").getByRole("button", { name: "高亮", exact: true }).click();

  const row = page.locator(".pdf-annotation-item.highlight").first();
  const summary = row.locator(".pdf-annotation-summary");
  const quote = await summary.locator(".pdf-annotation-excerpt").innerText();
  const userNote = "这里的论述是否充分？需要区分观察与推断。";
  await summary.click();
  await row.getByLabel("补充批注笔记").fill(userNote);
  await row.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect.poll(() => page.evaluate((note) => Object.keys(localStorage).some((key) =>
    key.startsWith("liteasy.pdf-annotations/v1:") && (localStorage.getItem(key) ?? "").includes(note),
  ), userNote)).toBe(true);

  const seededReview = "需要核对原文的适用条件，并补充支持该结论的证据。";
  await page.evaluate(({ note, review }) => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("liteasy.pdf-annotations/v1:") && (localStorage.getItem(candidate) ?? "").includes(note),
    );
    if (!key) throw new Error("The UI-created annotation was not persisted.");
    const annotations = JSON.parse(localStorage.getItem(key)!);
    const entry = annotations.find((annotation: { note?: string }) => annotation.note === note);
    const now = new Date().toISOString();
    entry.review = { text: review, sourceRevision: entry.revision, generatedAt: now, updatedAt: now };
    entry.revision += 1;
    entry.updatedAt = now;
    localStorage.setItem(key, JSON.stringify(annotations));
  }, { note: userNote, review: seededReview });
  await page.reload();
  await summary.click();
  await expect(row.getByRole("button", { name: `AI review：${quote}`, exact: true })).toBeEnabled();
  const review = row.getByRole("region", { name: "AI review", exact: true });
  await expect(review).toContainText(seededReview);
  await review.getByRole("button", { name: "编辑 AI review", exact: true }).click();
  const editedReview = "已核对原文：当前证据支持观察结果，但不足以建立因果关系。下一步补充对照实验。";
  await review.getByRole("textbox", { name: "AI review 内容", exact: true }).fill(editedReview);
  await review.getByRole("button", { name: "保存 AI review", exact: true }).click();
  await expect(review).toContainText(editedReview);
  await expect(review.getByRole("textbox")).toHaveCount(0);
  await page.reload();
  await summary.click();
  await expect(review).toContainText(editedReview);
  await expect(row.getByRole("textbox", { name: "补充批注笔记", exact: true })).toHaveValue(userNote);
  await expect(summary.locator(".pdf-annotation-excerpt")).toHaveText(quote);
  await expect(pdfPage.locator(".pdf-text-layer")).not.toBeEmpty({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("pdf-entry-review.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "研究白板", exact: true }).click();
  await summary.dragTo(page.getByLabel("白板卡片区域", { exact: true }));
  const card = page.locator(".object-placement");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".object-body")).toContainText(userNote);
  await expect(card.locator(".object-body")).toContainText(editedReview);
  await expect(card.locator(".object-source-quote blockquote")).toHaveText(quote);
  await card.hover();
  const resize = (await card.getByRole("button", { name: "调整卡片大小：下边", exact: true }).boundingBox())!;
  const originalHeight = (await card.boundingBox())!.height;
  // The edge midpoint is the connector; the remaining edge resizes the card.
  await page.mouse.move(resize.x + resize.width / 4, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 4, resize.y + resize.height / 2 + 160, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(originalHeight + 140);
  await page.getByLabel("白板卡片区域", { exact: true }).click({ position: { x: 330, y: 650 } });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("pdf-entry-review-board.png"), fullPage: true, animations: "disabled" });
});
