import { test, expect } from "@playwright/test";
import { readingPdf } from "../../../../../../../development/test-data/mobile-reading/fixtures.mjs";

test("phone reading reflows the current page, returns to original geometry and closes layers before leaving", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "navigation.pdf", mimeType: "application/pdf", buffer: Buffer.from(readingPdf()) });
  await page.locator(".resource-open").click();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeHidden();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByRole("button", { name: "文本重排", exact: true }).click();
  await expect(page.getByRole("article", { name: "第 2 页重排文本" })).toContainText("Mobile reading page 2");
  await expect(page.locator(".pdf-page canvas")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "批注工具" })).toHaveCount(0);
  await page.getByRole("slider", { name: "重排文字大小" }).fill("26");
  await expect(page.locator(".reflow-text")).toHaveCSS("font-size", "26px");
  await page.getByRole("button", { name: "查看第 2 页原文" }).click();
  await expect(page.locator('.pdf-page[data-page="2"]')).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "PDF 目录" })).toHaveCount(0);
  await expect(page.locator(".pdf-page")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.locator(".resource-open")).toBeVisible();
});

test("tablet keeps a usable master list beside the reader through orientation changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "tablet.pdf", mimeType: "application/pdf", buffer: Buffer.from(readingPdf()) });
  await page.locator(".resource-open").click();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("textbox", { name: "搜索资料" })).toBeVisible();
  const list = await page.locator(".library-master").boundingBox(); const reader = await page.locator(".library-document").boundingBox();
  expect(reader!.x).toBeGreaterThanOrEqual(list!.x + list!.width - 1);
  expect(reader!.width).toBeGreaterThan(600);
  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.getByRole("textbox", { name: "搜索资料" })).toBeHidden();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  expect(await page.locator("body").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(412);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("textbox", { name: "搜索资料" })).toBeVisible();
  await expect(page.locator(".pdf-page canvas")).toHaveCount(1);
});

test("two-finger PDF zoom commits new geometry without adding handwriting", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "pinch.pdf", mimeType: "application/pdf", buffer: Buffer.from(readingPdf()) });
  await page.locator(".resource-open").click();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  const box = (await page.locator(".pdf-page").boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const point = (id: number, x: number) => ({ id, x: box.x + x, y: box.y + 180, radiusX: 3, radiusY: 3, force: 0.7 });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(1, 120), point(2, 200)] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(1, 80), point(2, 240)] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("button", { name: "适应宽度" })).toHaveText("200%");
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".annotation-canvas g")).toHaveCount(0);
});
