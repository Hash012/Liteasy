import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`complete file names and a single conversation toolbar in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto(`/src/tests/browser/fixtures/display-polish.html?${theme}`);
  const author = page.getByRole("button", { name: "作者：Bernhard Schölkopf", exact: true });
  await expect(author).toHaveText("Schölkopf");
  await author.hover();
  await expect(page.getByRole("tooltip", { name: "作者：Bernhard Schölkopf", exact: true })).toBeVisible();
  await author.click();
  await expect(page.getByLabel("最近操作")).toHaveText("Bernhard Schölkopf");
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.getByLabel("历史会话面板")).toBeVisible();
  await page.getByRole("button", { name: "隐藏历史", exact: true }).click();
  await page.getByRole("button", { name: "对话设置", exact: true }).click();
  await expect(page.getByLabel("最近操作")).toHaveText("设置");
  const title = page.locator(".assistant-active-session-title");
  for (const width of [1000, 360, 280]) {
    await page.setViewportSize({ width, height: 680 });
    const toolbar = page.getByRole("group", { name: "对话顶栏" });
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const titleBox = (await title.boundingBox())!;
    const buttonBox = (await toolbar.getByRole("button", { name: "新建", exact: true }).boundingBox())!;
    expect(Math.abs(titleBox.y + titleBox.height / 2 - buttonBox.y - buttonBox.height / 2)).toBeLessThan(2);
    const name = page.locator(".shell-file-name");
    await expect(name).toHaveText(/Evaluation Results\.pdf$/);
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    const status = (await page.getByLabel("文件状态栏", { exact: true }).boundingBox())!;
    expect(status.y + status.height).toBe(680);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width !== 280) await page.screenshot({ path: info.outputPath(`display-${theme}-${width}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(title).toHaveText("新对话");
});
