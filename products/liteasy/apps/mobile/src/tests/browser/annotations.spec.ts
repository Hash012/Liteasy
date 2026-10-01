import { test, expect } from "@playwright/test";
import { readingPdf } from "../../../../../../../development/test-data/mobile-reading/fixtures.mjs";

test("saves highlights and pen strokes, preserves coordinates across zoom, and restores after reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "annotate.pdf", mimeType: "application/pdf", buffer: Buffer.from(readingPdf()) });
  await page.locator(".resource-open", { hasText: "annotate.pdf" }).click();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  await page.locator(".textLayer").evaluate((layer) => {
    const node = Array.from(layer.querySelectorAll("span")).find((span) => span.textContent?.startsWith("Mobile reading"))!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 6);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole("button", { name: "高亮选区" }).click();
  await expect(page.locator(".annotation-canvas g")).toHaveCount(1);
  const before = await page.locator(".annotation-canvas rect").first().getAttribute("x");
  await page.getByRole("button", { name: "手写", exact: true }).click();
  const layer = page.locator(".annotation-canvas");
  await layer.scrollIntoViewIfNeeded();
  const bounds = (await layer.boundingBox())!;
  // Chromium generates trusted pen events, including native pointer capture ownership.
  const pen = await page.context().newCDPSession(page);
  for (const [type, x, y] of [["mousePressed", 0.2, 0.25], ["mouseMoved", 0.35, 0.35], ["mouseReleased", 0.45, 0.3]] as const) {
    await pen.send("Input.dispatchMouseEvent", { type, pointerType: "pen", button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y });
  }
  await expect(page.locator(".annotation-canvas g")).toHaveCount(2);
  const stroke = await page.locator(".annotation-canvas g path").getAttribute("d");
  await page.getByRole("button", { name: "撤销批注" }).click();
  await expect(page.locator(".annotation-canvas g")).toHaveCount(1);
  await page.getByRole("button", { name: "重做批注" }).click();
  await expect(page.locator(".annotation-canvas g")).toHaveCount(2);
  await page.getByRole("button", { name: "放大", exact: true }).click();
  expect(await page.locator(".annotation-canvas rect").first().getAttribute("x")).toBe(before);
  expect(await page.locator(".annotation-canvas g path").getAttribute("d")).toBe(stroke);
  await page.getByRole("button", { name: "添加便签" }).click();
  const scaled = (await layer.boundingBox())!;
  await layer.dispatchEvent("pointerdown", { pointerId: 8, pointerType: "touch", isPrimary: true, button: 0, clientX: scaled.x + 50, clientY: scaled.y + 100 });
  await page.getByLabel("批注内容").fill("需要跟进的想法");
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑批注 需要跟进的想法" })).toBeVisible();
  await page.getByRole("button", { name: "返回资料库" }).click();
  await page.reload();
  await page.locator(".resource-open", { hasText: "annotate.pdf" }).click();
  await expect(page.locator(".annotation-canvas g")).toHaveCount(3);
  expect(await page.locator(".annotation-canvas g path").getAttribute("d")).toBe(stroke);
  await expect(page.getByRole("button", { name: "编辑批注 需要跟进的想法" })).toBeVisible();
  expect(errors).toEqual([]);
});
