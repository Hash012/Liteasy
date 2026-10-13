import { expect, test } from "@playwright/test";

test("interactive reading and login inherit theme; announcements remain accessible without layout", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/ui-root-cause.html");
  await page.getByRole("button", { name: "深色主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await page.screenshot({ path: info.outputPath("theme.png"), fullPage: true });
  const surface = await page.locator(".thin-reading").evaluate(e => getComputedStyle(e).backgroundColor);
  const channels = surface.match(/[\d.]+/g)!.map(Number);
  expect(channels.slice(0, 3).every(n => n < 90)).toBe(true);
  const login = page.getByRole("button", { name: "登录", exact: true }).first();
  const contrast = await login.evaluate(e => {
    const s = getComputedStyle(e);
    const lum = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i], 0);
    const a = lum(s.color), b = lum(s.backgroundColor);
    return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await login.click();
  await expect(page.getByText("已触发登录入口")).toBeVisible();
  const announcement = page.getByRole("status").filter({ hasText: /回复/ });
  await expect(announcement).toHaveCount(1);
  expect(await announcement.evaluate(e => ({ width: e.getBoundingClientRect().width, position: getComputedStyle(e).position, display: getComputedStyle(e).display })))
    .toEqual({ width: 1, position: "absolute", display: "block" });
});

for (const theme of ["深色主题", "浅色主题"]) test(`recommendations preserve honest reasons and keyboard actions at three widths in ${theme}`, async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/ui-root-cause.html");
  await page.getByRole("button", { name: theme, exact: true }).click();
  const panel = page.getByRole("region", { name: "推荐宽度验收" });
  for (const width of [280, 360, 480]) {
    await page.getByRole("combobox", { name: "推荐区域宽度" }).selectOption(String(width));
    const row = panel.getByRole("button", { name: /^查看推荐 很长/ });
    await row.focus();
    for (const detail of await panel.locator("details").all()) { if (!await detail.getAttribute("open").then(value => value !== null)) await detail.locator("summary").click(); }
    await expect(panel.getByText("来源提供的理由：主题与并发控制有关")).toBeVisible();
    await expect(panel.getByText("未提供个别推荐理由")).toBeVisible();
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`recommendations-${width}.png`), fullPage: true });
    const save = panel.getByRole("button", { name: /^收藏/ }).first();
    await save.focus(); await save.press("Enter");
    await expect(page.getByText("已收藏：reason", { exact: true })).toBeVisible();
    const dismiss = panel.getByRole("button", { name: /^忽略/ }).first();
    await dismiss.focus(); await dismiss.press("Enter");
    await expect(page.getByText("已忽略：reason", { exact: true })).toBeVisible();
  }
});
