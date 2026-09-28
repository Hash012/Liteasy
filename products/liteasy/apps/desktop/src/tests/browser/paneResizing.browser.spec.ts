import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragDivider(page: Page, divider: Locator, dx: number, dy = 0) {
  const box = (await divider.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Many small moves reproduce the stale-width regression; a single move hides it.
  await page.mouse.move(x + dx, y + dy, { steps: 30 });
  await page.mouse.up();
}

test("column dividers follow continuous dragging and persist both adjacent widths", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const columns = page.locator(".dock-workspace-columns");
  const left = columns.locator('[data-region="left"]');
  const main = columns.locator('[data-region="main"]');
  const right = columns.locator('[data-region="right"]');
  await expect(left).toBeVisible();
  const width = async (item: Locator) => (await item.boundingBox())!.width;
  const original = [await width(left), await width(main), await width(right)];
  await dragDivider(page, columns.getByRole("separator").first(), 120);
  await expect.poll(async () => (await width(left)) - original[0]).toBeCloseTo(120, 0);
  expect((await width(main)) - original[1]).toBeCloseTo(-120, 0);
  expect(await width(right)).toBeCloseTo(original[2], 0);
  await dragDivider(page, columns.getByRole("separator").last(), -90);
  expect((await width(right)) - original[2]).toBeCloseTo(90, 0);
  const resized = [await width(left), await width(main), await width(right)];
  await page.reload();
  await expect(left).toBeVisible();
  expect([await width(left), await width(main), await width(right)]).toEqual(resized);
  const divider = columns.getByRole("separator").first();
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  expect((await width(left)) - resized[0]).toBeCloseTo(-10, 0);
});

test("bottom height and split widths can be resized independently", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "展开下栏", exact: true }).click();
  const bottom = page.locator('[data-region="bottom"]');
  const height = (await bottom.boundingBox())!.height;
  await dragDivider(page, page.getByRole("separator", { name: "调整下栏高度", exact: true }), 0, -100);
  expect((await bottom.boundingBox())!.height - height).toBeGreaterThan(85);
  await bottom.getByRole("button", { name: "下栏面板选项" }).click();
  await page.getByRole("menuitem", { name: "在右边新建栏" }).click();
  const split = page.locator('.dock-bottom-columns > [data-region^="bar-"]');
  const width = (await split.boundingBox())!.width;
  await dragDivider(page, page.getByRole("separator", { name: "调整下栏分栏宽度", exact: true }), -110);
  expect((await split.boundingBox())!.width - width).toBeCloseTo(110, 0);
});
