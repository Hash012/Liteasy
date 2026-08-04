import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("downloads generated artifacts as Markdown, HTML, and internally generated PDF", async ({ page }) => {
  await page.goto("/?artifact-export-fixture");

  await page.getByRole("button", { name: "导出为文档" }).click();
  await expect(page.getByRole("menuitem", { name: "PDF (.pdf)" })).toBeVisible();

  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe("QVLA 导出测试.md");
  const markdownPath = await markdownDownload.path();
  expect(markdownPath).not.toBeNull();
  expect(await readFile(markdownPath!, "utf8")).toContain("QVLA 使用动作空间敏感度");

  await page.getByRole("button", { name: "导出为文档" }).click();
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML (.html)" }).click();
  const htmlDownload = await htmlDownloadPromise;
  expect(htmlDownload.suggestedFilename()).toBe("QVLA 导出测试.html");
  const htmlPath = await htmlDownload.path();
  expect(htmlPath).not.toBeNull();
  const html = await readFile(htmlPath!, "utf8");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("QVLA 思维导图");

  await page.getByRole("button", { name: "导出为文档" }).click();
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "PDF (.pdf)" }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toBe("QVLA 导出测试.pdf");
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).not.toBeNull();
  expect((await readFile(pdfPath!)).subarray(0, 8).toString()).toBe("%PDF-1.7");
});
