import { expect, test } from "@playwright/test";

test("Agent and help remain reachable after closing, moving and reopening the workbench", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  const agent = nav.getByRole("button", { name: "Agent", exact: true });
  await page
    .getByRole("button", { name: "关闭 Liteasy Chat", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(agent).toHaveAttribute("aria-pressed", "false");
  await nav.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "研究白板", exact: true }),
  ).toBeVisible();
  await agent.click();
  await expect(
    page.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "研究白板", exact: true }),
  ).toHaveCount(0);
  await expect(agent).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("tab", { name: "Liteasy Chat", exact: true })
    .press("Alt+Shift+ArrowDown");
  await agent.click();
  await expect(
    page
      .locator(".dock-region-bottom")
      .getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Liteasy Chat", exact: true })
    .press("Alt+Shift+ArrowRight");
  await nav.getByRole("button", { name: "帮助", exact: true }).click();
  const help = page.getByRole("region", { name: "帮助", exact: true });
  await expect(
    help.getByRole("navigation", { name: "帮助目录" }),
  ).toBeVisible();
  await help.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(help).toContainText("此目录暂无帮助条目。");
  await help.getByRole("textbox", { name: "搜索帮助" }).fill("选区");
  await expect(help).toContainText("没有匹配的帮助条目。");
  await page.getByRole("button", { name: "关闭 帮助", exact: true }).click();
  await expect(help).toHaveCount(0);
  await page.keyboard.press("F1");
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "帮助首页", exact: true }).click();
  await expect(help.getByRole("textbox", { name: "搜索帮助" })).toHaveValue("");
  await expect(help.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(help).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "薄读", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("help-navigation.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(help).toBeVisible();
  await expect(agent).toBeVisible();
});

test("help opens above an active PDF and returns to the document tab", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(
    new URL(
      "../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf",
      import.meta.url,
    ),
  );
  await page.route("**/manual-preview/das24a.pdf", (route) =>
    route.fulfill({ body: bytes, contentType: "application/pdf" }),
  );
  await page.goto("/?pdf-highlight-fixture#importable");
  const text = page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer');
  await expect(text).not.toBeEmpty({ timeout: 30000 });
  await page.keyboard.press("F1");
  await expect(
    page.getByRole("region", { name: "帮助", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "das24a.pdf", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  await expect(text).toBeVisible();
});
