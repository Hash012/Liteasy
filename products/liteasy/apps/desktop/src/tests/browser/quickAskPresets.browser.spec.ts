import { expect, test } from "@playwright/test";
const fixture = "/src/tests/browser/fixtures/quick-ask-presets.html";
test("real preset controls remain contained at four widths, both themes, forced colors and doubled CSS scale", async ({ page }, info) => {
  await page.goto(fixture);
  const requests: string[] = []; page.on("request", request => { if (/chat\/completions|\/responses/.test(request.url())) requests.push(request.url()); });
  for (const width of [320, 448, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const appearance of ["light", "dark", "forced"] as const) {
      if (appearance === "dark") await page.getByRole("button", { name: "切换主题" }).click();
      await page.emulateMedia({ forcedColors: appearance === "forced" ? "active" : "none" });
      await expect(page.getByRole("button", { name: "解释选段", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`presets-${width}-${appearance}.png`), fullPage: true, animations: "disabled" });
    }
    await page.emulateMedia({ forcedColors: "none" }); await page.getByRole("button", { name: "切换主题" }).click();
  }
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const name of ["翻译", "拆解推导", "举个例子", "讲清楚"]) await page.getByRole("button", { name, exact: true }).click();
  expect(requests).toEqual([]);
});
test("custom draft survives switching; real settings save/reload and account isolation", async ({ page }, info) => {
  await page.goto(fixture);
  await page.getByRole("textbox", { name: "本次指令", exact: true }).fill("只用中文推导\n保留 $E=mc²$");
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本次指令", exact: true })).toHaveValue("只用中文推导\n保留 $E=mc²$");
  await expect(page.getByTestId("primary-task")).toHaveText("发送");
  await page.getByRole("button", { name: "使用预设", exact: true }).click();
  await expect(page.getByTestId("primary-task")).toHaveText("翻译选段");
  await page.getByRole("button", { name: "恢复自定义草稿" }).click();
  await expect(page.getByRole("textbox", { name: "本次指令", exact: true })).toHaveValue("只用中文推导\n保留 $E=mc²$");
  await page.getByRole("textbox", { name: "快捷指令名称", exact: true }).fill("跨论文复用");
  await page.getByRole("textbox", { name: "完整快捷指令", exact: true }).fill("This is an intentionally long bilingual instruction 中英混合 $α$\n```ts\nconst code = 'literal';\n```");
  await page.getByRole("button", { name: "保存快捷指令", exact: true }).click();
  await expect(page.getByText(/已保存 ·/)).toBeVisible();
  await page.reload();
  await page.getByRole("combobox", { name: "更多速问任务" }).click();
  await expect(page.getByRole("option", { name: "跨论文复用", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "管理快捷指令", exact: true }).click();
  await page.getByRole("option", { name: /^跨论文复用/ }).click();
  await expect(page.getByRole("textbox", { name: "完整快捷指令" })).toHaveValue(/const code = 'literal'/);
  await page.getByRole("combobox", { name: "测试账号" }).selectOption("browser-preset-b");
  await expect(page.getByRole("textbox", { name: "快捷指令名称" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "更多速问任务" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "测试账号" }).selectOption("browser-preset-a");
  await page.getByRole("combobox", { name: "更多速问任务" }).click();
  await expect(page.getByRole("option", { name: "跨论文复用", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByText("导入与导出", { exact: true }).click();
  await page.getByLabel("导入快捷指令文件").setInputFiles({ name: "unsupported.json", mimeType: "application/json", buffer: Buffer.from('{"schema":"unknown/v9","instruction":"must retain"}') });
  await expect(page.getByRole("textbox", { name: "待导入的快捷指令" })).toHaveValue('{"schema":"unknown/v9","instruction":"must retain"}');
  await page.getByRole("button", { name: "验证并导入为个人副本" }).click();
  await expect(page.getByRole("alert")).toContainText("不支持");
  await expect(page.getByRole("textbox", { name: "待导入的快捷指令" })).toHaveValue('{"schema":"unknown/v9","instruction":"must retain"}');
  await page.screenshot({ path: info.outputPath("saved-restarted-scope.png"), fullPage: true, animations: "disabled" });
});
test("two real browser windows enforce CAS and preserve the losing draft", async ({ context }, info) => {
  const first = await context.newPage(), second = await context.newPage();
  await first.goto(fixture); await second.goto(fixture);
  await second.getByRole("textbox", { name: "快捷指令名称" }).fill("并发草稿");
  await second.getByRole("textbox", { name: "完整快捷指令" }).fill("不能丢失的多窗口输入");
  await first.getByRole("textbox", { name: "快捷指令名称" }).fill("已保存版本");
  await first.getByRole("textbox", { name: "完整快捷指令" }).fill("来自另一窗口");
  await first.getByRole("button", { name: "保存快捷指令", exact: true }).click();
  await expect(first.getByText(/已保存 ·/)).toBeVisible();
  await second.getByRole("button", { name: "保存快捷指令", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("其他窗口修改");
  await expect(second.getByRole("textbox", { name: "完整快捷指令" })).toHaveValue("不能丢失的多窗口输入");
  await second.getByRole("combobox", { name: "更多速问任务" }).click();
  await expect(second.getByRole("option", { name: "已保存版本", exact: true })).toBeVisible();
  await second.keyboard.press("Escape");
  await second.screenshot({ path: info.outputPath("multiwindow-cas-draft.png"), fullPage: true, animations: "disabled" });
});
