import { test, expect } from "@playwright/test";
import { readingPdf } from "../../../../../../../development/test-data/mobile-reading/fixtures.mjs";

test("imports, reads, searches, follows outline and restores a PDF after reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "reader.pdf", mimeType: "application/pdf", buffer: Buffer.from(readingPdf()) });
  await page.locator(".resource-open", { hasText: "reader.pdf" }).click();
  await expect(page.locator('.pdf-page[data-page="1"]')).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".textLayer")).toContainText("Mobile reading page 1");
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: "Second chapter · 2" }).click();
  await expect(page.getByRole("textbox", { name: "页码" })).toHaveValue("2");
  await page.getByRole("button", { name: "搜索 PDF", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索 PDF 内容" }).fill("reading page 1");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: /第 1 页：/ }).click();
  await expect(page.locator('.pdf-page[data-page="1"]')).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.getByRole("button", { name: "适应宽度" })).toHaveText("125%");
  await page.getByRole("textbox", { name: "页码" }).fill("3");
  await page.getByRole("textbox", { name: "页码" }).press("Enter");
  await expect(page.locator('.pdf-page[data-page="3"]')).toHaveAttribute("aria-busy", "false");
  expect(await page.locator(".textLayer").innerText()).toBe("");
  const pixel = await page.locator(".pdf-page canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(canvas.width / 3), Math.floor(canvas.height / 2), 1, 1).data);
  });
  expect(pixel.slice(0, 3)).not.toEqual([255, 255, 255]);
  await page.getByRole("button", { name: "返回资料库" }).click();
  await expect(page.locator(".resource-open")).toContainText("第 3 页");
  await page.reload();
  await page.locator(".resource-open", { hasText: "reader.pdf" }).click();
  await expect(page.getByRole("textbox", { name: "页码" })).toHaveValue("3");
  await expect(page.locator('.pdf-page[data-page="3"]')).toHaveAttribute("aria-busy", "false");
  expect(errors).toEqual([]);
});

test("long PDFs render one bounded canvas while jumping and zooming", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "long.pdf", mimeType: "application/pdf", buffer: Buffer.from(readingPdf(120)) });
  await page.locator(".resource-open", { hasText: "long.pdf" }).click();
  for (const number of [1, 60, 120, 2]) {
    await page.getByRole("textbox", { name: "页码" }).fill(String(number));
    await page.getByRole("textbox", { name: "页码" }).press("Enter");
    await expect(page.locator(`.pdf-page[data-page="${number}"]`)).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".pdf-page canvas")).toHaveCount(1);
  }
  for (let index = 0; index < 12; index++) await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  expect(await page.locator(".pdf-page canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height)).toBeLessThanOrEqual(4_000_000);
});
