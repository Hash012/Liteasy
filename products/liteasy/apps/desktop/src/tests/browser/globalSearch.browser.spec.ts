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
    for (let index = 0; index < 12; index++) await repository.create({ kind: "content.note", title: `Other synthetic note ${index}`, content: { schema: "liteasy.note/v1", payload: { origin: "user", text: "Episodic memory test phrase.\n".repeat(20) } } });
  });
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", { name: "搜索工作区" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "搜索词或引号短语" }).fill('"Episodic memory"');
  await expect(dialog.getByRole("button", { name: /Synthetic retrieval note/ })).toBeVisible();
  await dialog.getByRole("button", { name: "保存查询", exact: true }).click();
  await expect(dialog.getByLabel("保存的查询")).toContainText('"Episodic memory"');
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(900 * 0.86 + 1);
  expect(await page.getByLabel("搜索结果", { exact: true }).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
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

test("title-only matches do not flood book results and reopening or focus does not restart the search", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  const search = page.getByRole("toolbar", { name: "工作区命令栏" }).getByRole("button", { name: "搜索工作区", exact: true });
  await expect(search).toBeVisible();
  await page.evaluate(async () => {
    const { createReadingLibraryRepository } = await import("/src/app/features/reading-library/readingLibraryRepository.ts");
    const { createObjectStorage } = await import("/src/app/features/objects/objectStorage.ts");
    const body = "与人物关键词无关的日常叙述。\n".repeat(1200);
    await createReadingLibraryRepository(createObjectStorage("local", () => "local"), "local").importFile("巴赫传.epub", new TextEncoder().encode("synthetic book"), {
      format: "epub", title: "巴赫传", authors: ["Test Author"], chapters: [{ id: "1", title: "第一章", content: body, plainText: body, format: "text" }],
      toc: [], resources: [], warnings: [],
    });
  });
  await search.click();
  const dialog = page.getByRole("dialog", { name: "搜索工作区" });
  await dialog.getByRole("textbox", { name: "搜索词或引号短语" }).fill("巴赫");
  await expect(dialog.locator(".global-search-hit")).toHaveCount(1);
  await expect(dialog.locator(".global-search-hit")).toContainText("文件与元信息");
  await expect(dialog.locator(".global-search-status")).not.toContainText("正在检索");
  await page.evaluate(() => {
    const tracker = window as Window & { searchRestarts?: number };
    tracker.searchRestarts = 0;
    new MutationObserver(() => {
      if (document.querySelector(".global-search-status")?.textContent?.includes("正在检索")) tracker.searchRestarts!++;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.dispatchEvent(new Event("focus"));
  });
  await dialog.getByRole("button", { name: "保存查询", exact: true }).click();
  await page.keyboard.press("Escape");
  await search.click();
  await page.waitForTimeout(500); // Cross the controller's debounce to detect an unintended restart.
  await expect(dialog.locator(".global-search-hit")).toHaveCount(1);
  expect(await page.evaluate(() => (window as Window & { searchRestarts?: number }).searchRestarts)).toBe(0);
  await dialog.getByRole("combobox", { name: "搜索范围" }).selectOption("body");
  await expect(dialog.getByText(/已索引内容中未找到匹配项/)).toBeVisible();
});

test("tag/format exclusions combine with regex and navigation paints only the matched book text", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  await page.evaluate(async () => {
    const { createReadingLibraryRepository } = await import("/src/app/features/reading-library/readingLibraryRepository.ts");
    const { createObjectStorage } = await import("/src/app/features/objects/objectStorage.ts");
    const library = createReadingLibraryRepository(createObjectStorage("local", () => "local"), "local");
    for (const [name, tags] of [["Research", ["精读"]], ["Translation", ["精读", "翻译"]]] as const) {
      const text = "Unrelated opening. Episodic memory 42 is the actual match. Unrelated ending.";
      const { entry } = await library.importFile(`${name}.md`, new TextEncoder().encode(text), { format: "markdown", title: name, authors: [],
        chapters: [{ id: "1", title: "Chapter", content: text, plainText: text, format: "markdown" }], toc: [], resources: [], warnings: [] });
      await library.updateMetadata(entry.id, { tags: [...tags], assetType: "note" });
    }
  });
  await page.getByRole("button", { name: "搜索工作区", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "搜索工作区" });
  await dialog.getByRole("textbox", { name: "搜索词或引号短语" }).fill('/memory \\d+/i tag:精读 -tag:翻译 format:md');
  await dialog.getByRole("combobox", { name: "搜索范围" }).selectOption("body");
  await expect(dialog.locator(".global-search-hit")).toHaveCount(1);
  await expect(dialog.locator("mark")).toHaveText("memory 42");
  await dialog.locator(".global-search-hit").click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => [...(CSS.highlights.get("liteasy-search-match") ?? [])].map((range) => range.toString()))).toEqual(["memory 42"]);
  const reader = page.getByLabel("文件阅读器");
  await reader.getByRole("button", { name: "搜索正文", exact: true }).click();
  await reader.getByRole("textbox", { name: "搜索书内文字" }).fill('/memory \\d+/i -tag:精读');
  await expect(reader.getByText("没有找到匹配的文字")).toBeVisible();
  await reader.getByRole("textbox", { name: "搜索书内文字" }).fill('/memory \\d+/i tag:精读');
  await expect(reader.getByText("1 处匹配")).toBeVisible();
});
