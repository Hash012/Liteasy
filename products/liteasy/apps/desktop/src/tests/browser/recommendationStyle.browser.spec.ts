import { expect, test } from "@playwright/test";

test("researchers can choose and persist their paper discovery style", async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const settingsButton = page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "设置", exact: true });
  await settingsButton.click();
  const style = page.getByRole("combobox", { name: "推荐风格", exact: true });
  await expect(style).toHaveValue("balanced");
  await style.selectOption("classic");
  await expect(style).toHaveValue("classic");
  await style.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("recommendation-style-settings.png"), fullPage: true, animations: "disabled" });
  await page.reload();
  if (!(await style.isVisible())) await settingsButton.click();
  await expect(style).toHaveValue("classic");
  await style.selectOption("frontier");
  await expect(style).toHaveValue("frontier");
  expect(errors).toEqual([]);
});
