import { expect, test } from "@playwright/test";

test("independent bars retain Notes and board tabs, while Agent can move into the bottom panel", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1800, height: 1080 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "研究白板", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "研究白板", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
  await page
    .locator('[data-region="main"]')
    .getByRole("button", { name: "主内容区面板选项" })
    .click();
  await page.getByRole("menuitem", { name: "在左边新建栏" }).click();
  const columns = page.locator(".dock-workspace-columns > .dock-region");
  await expect(columns).toHaveCount(5);
  const emptyBar = page
    .locator('[data-region^="bar-"]')
    .filter({ hasNot: page.getByRole("tab") })
    .first();
  const notesBarId = await emptyBar.getAttribute("data-region");
  await nav.getByRole("button", { name: "笔记", exact: true }).dragTo(emptyBar);
  const notesBar = page.locator(`[data-region="${notesBarId}"]`);
  await expect(
    notesBar.getByRole("tab", { name: "笔记", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(columns).toHaveCount(5);
  await expect(
    notesBar.getByRole("tab", { name: "笔记", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "研究白板", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "展开下栏", exact: true }).click();
  const bottom = page.locator('[data-region="bottom"]');
  await expect(bottom).toBeVisible();
  await page
    .getByRole("tab", { name: "Liteasy Chat", exact: true })
    .dragTo(bottom);
  await expect(
    bottom.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "研究白板", exact: true }),
  ).toBeVisible();
  await notesBar.getByRole("button", { name: "分栏面板选项" }).click();
  await page.getByRole("menuitem", { name: "关闭面板", exact: true }).click();
  await expect(notesBar).toHaveCount(0);
  await expect(
    page
      .locator('[data-region="main"]')
      .getByRole("tab", { name: "笔记", exact: true }),
  ).toBeVisible();
  await bottom.getByRole("button", { name: "下栏面板选项" }).click();
  await page.getByRole("menuitem", { name: "在右边新建栏" }).click();
  const bottomSplit = page.locator(
    '.dock-bottom-columns > [data-region^="bar-"]',
  );
  await expect(bottomSplit).toHaveCount(1);
  await bottom
    .getByRole("tab", { name: "Liteasy Chat", exact: true })
    .dragTo(bottomSplit);
  await expect(
    bottomSplit.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "折叠下栏", exact: true }).click();
  await nav.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(
    bottomSplit.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
  await bottomSplit
    .getByRole("tab", { name: "Liteasy Chat", exact: true })
    .dragTo(bottom);
  await page.screenshot({
    path: testInfo.outputPath("dock-workspace.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(
    bottom.getByRole("tab", { name: "Liteasy Chat", exact: true }),
  ).toBeVisible();
});

test("PDF tabs move into a new bar and preserve their resource drag payload", async ({
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(
    page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer'),
  ).not.toBeEmpty({ timeout: 30000 });
  await page
    .locator('[data-region="main"]')
    .getByRole("button", { name: "主内容区面板选项" })
    .click();
  await page.getByRole("menuitem", { name: "在右边新建栏" }).click();
  const newBar = page.locator('[data-region^="bar-"]');
  await page
    .getByRole("tab", { name: "das24a.pdf", exact: true })
    .dragTo(newBar);
  await expect(
    newBar.getByRole("tab", { name: "das24a.pdf", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    newBar.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer'),
  ).not.toBeEmpty({ timeout: 30000 });
  const payload = await newBar
    .getByRole("tab", { name: "das24a.pdf", exact: true })
    .evaluate((tab) => {
      const transfer = new DataTransfer();
      tab.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
      );
      tab.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
      );
      return {
        paper: transfer.getData("application/x-liteasy-paper-context"),
        tab: transfer.getData("application/x-liteasy-dynamic-tab"),
      };
    });
  expect(payload.paper).toBeTruthy();
  expect(payload.tab).toBe(`pdf-${payload.paper}`);
  await page
    .locator('[data-region="main"]')
    .getByRole("button", { name: "主内容区面板选项" })
    .click();
  await page.getByRole("menuitem", { name: "关闭面板", exact: true }).click();
  await expect(
    newBar.getByRole("tab", { name: "das24a.pdf", exact: true }),
  ).toBeVisible();
  await expect(
    newBar.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer'),
  ).not.toBeEmpty();
});

test("activity entries dock through the body of a persistent Agent surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  const right = page.locator('[data-region="right"]');
  const surface = right.locator(".dock-persistent-surface");
  await expect(surface).toBeVisible();
  await nav.getByRole("button", { name: "帮助", exact: true }).dragTo(surface);
  await expect(
    right.getByRole("tab", { name: "帮助", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await right.getByRole("button", { name: "关闭 帮助", exact: true }).click();
  await expect(surface).toBeVisible();
});
