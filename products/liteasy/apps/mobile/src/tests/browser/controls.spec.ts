import { expect, test } from "@playwright/test";

test("native mobile pickers keep named values, readable offline state and 44px touch targets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/src/tests/browser/fixtures/mobile-controls.html");
  for (const name of ["分类", "目标桌面", "任务", "文献"]) {
    const picker = page.getByRole("combobox", { name, exact: true });
    await expect(picker).toBeVisible();
    expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("combobox", { name: "分类", exact: true }).selectOption(itemCollection);
  await expect(page.getByRole("combobox", { name: "分类", exact: true })).toHaveValue(itemCollection);
  await page.getByRole("combobox", { name: "目标桌面", exact: true }).selectOption("desktop");
  await page.getByRole("combobox", { name: "文献", exact: true }).selectOption("paper");
  await expect(page.getByRole("button", { name: "发送任务", exact: true })).toBeEnabled();
  await expect(page.getByText(/离线，可排队/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("mobile-controls.png"), fullPage: true });
});

const itemCollection = "跨团队论文阅读的超长分类名称";
