import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("help reviews and downloads an environment-only package locally; reload returns to opt-out", async ({ page }, testInfo) => {
  // Fresh synthetic browser profile; no native transport, external service or document fixture.
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.local-literature.v1", JSON.stringify({ "papers.local_mode": true, "profile.local_enabled": true }));
  });
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "帮助", exact: true }).click();
  const help = page.getByRole("region", { name: "帮助", exact: true });
  await help.getByText("本地诊断", { exact: true }).click();
  const enabled = help.getByRole("switch", { name: "记录本次窗口的诊断" });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await help.getByRole("button", { name: "预览诊断包", exact: true }).click();
  const preview = await help.getByRole("textbox", { name: "诊断包 JSON 预览" }).inputValue();
  expect(JSON.parse(preview)).toMatchObject({ schema: "liteasy.local-diagnostics/v1", environment: { runtime: "browser" }, records: [] });
  const downloadPromise = page.waitForEvent("download");
  await help.getByRole("button", { name: "导出已预览的诊断包" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("liteasy-local-diagnostics.json");
  expect(await readFile((await download.path())!, "utf8")).toBe(preview);
  await help.screenshot({ path: testInfo.outputPath("diagnostics-reviewed.png") });
  await page.reload();
  await page.keyboard.press("F1");
  await help.getByText("本地诊断", { exact: true }).click();
  await expect(enabled).not.toBeChecked();
  await expect(help.getByRole("textbox", { name: "诊断包 JSON 预览" })).toHaveCount(0);
});
