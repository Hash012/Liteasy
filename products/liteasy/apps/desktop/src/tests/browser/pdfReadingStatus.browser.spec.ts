import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("ordinary library PDF reopen records reading after a real PDF.js load", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture#importable");
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  await page.getByRole("button", { name: "展开文件元信息", exact: true }).click();
  const inspector = page.locator(".shell-file-inspector");
  await expect(inspector.locator(".reading-catalog-eyebrow")).toContainText("在读");
  await inspector.getByRole("combobox", { name: "文件阅读状态" }).click();
  await page.getByRole("option", { name: "未读", exact: true }).click();
  await inspector.getByRole("button", { name: "保存整理信息", exact: true }).click();
  await expect(inspector.locator(".reading-catalog-eyebrow")).toContainText("未读");
  await expect(inspector.getByRole("status")).toContainText("已保存分类、标签和阅读状态");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭 das24a.pdf", exact: true }).click();

  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "文献库", exact: true }).dblclick();
  await page.getByRole("dialog", { name: "文献库", exact: true }).getByRole("button", { name: "das24a.pdf", exact: true }).dblclick();
  await expect(page.getByRole("tab", { name: "das24a.pdf", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开文件元信息", exact: true }).click();
  await expect(inspector.locator(".reading-catalog-eyebrow")).toContainText("在读");
  await expect(inspector.getByRole("button", { name: "编辑元信息", exact: true })).toHaveCount(1);
});
