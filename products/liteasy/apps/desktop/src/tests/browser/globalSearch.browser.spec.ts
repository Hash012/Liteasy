import { expect, test } from "@playwright/test";

test("top-center search works with keyboard, local bodies, saved queries and source navigation", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const bar = page.getByRole("toolbar", { name: "工作区命令栏" });
  const search = bar.getByRole("button", { name: "搜索工作区", exact: true });
  await expect(search).toBeVisible();
  const bounds = await search.boundingBox(); expect(Math.abs(bounds!.x + bounds!.width / 2 - 720)).toBeLessThan(2);
  // Synthetic local object, through the real browser storage/repository (no mocked search transport).
  await page.evaluate(async () => {
    const { createObjectRepository } = await import("/src/app/features/objects/objectRepository.ts");
    const { createObjectStorage } = await import("/src/app/features/objects/objectStorage.ts");
    const scope = "local";
    const repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
    await repository.create({ kind: "content.note", title: "Synthetic retrieval note", content: { schema: "liteasy.note/v1", payload: { origin: "user", text: "# Synthetic\n\nEpisodic memory test phrase.\n\nA second line." } } });
  });
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", { name: "搜索工作区" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "搜索词或引号短语" }).fill('"Episodic memory"');
  await expect(dialog.getByRole("button", { name: /Synthetic retrieval note/ })).toBeVisible();
  await dialog.getByRole("button", { name: "保存查询", exact: true }).click();
  await expect(dialog.getByLabel("保存的查询")).toContainText('"Episodic memory"');
  await page.screenshot({ path: testInfo.outputPath("global-search-light.png") });
  await dialog.getByRole("button", { name: /Synthetic retrieval note/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Synthetic retrieval note", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".resource-search-location")).toContainText("Episodic memory");
  for (const width of [960, 600, 400, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await search.boundingBox(); expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
    expect(await bar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await search.click(); await expect(dialog).toBeVisible(); await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(search).toBeFocused();
});
