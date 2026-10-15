import { expect, test, type Page } from "@playwright/test";

async function expectLibraryActionLayout(page: Page) {
  const collectionHeader = page.getByRole("region", { name: "收藏", exact: true }).locator(".library-section-header-row");
  await collectionHeader.hover();
  const heading = await collectionHeader.locator(".library-section-header").boundingBox();
  const collectionActions = await collectionHeader.getByRole("button", { name: "收藏更多操作", exact: true }).boundingBox();
  expect(heading).not.toBeNull(); expect(collectionActions).not.toBeNull();
  expect(Math.abs((heading!.y + heading!.height / 2) - (collectionActions!.y + collectionActions!.height / 2))).toBeLessThan(2);

  const recommendations = page.getByRole("region", { name: "关联推荐", exact: true });
  const disclosure = recommendations.getByRole("button", { name: /^(展开|收起)关联推荐$/ });
  if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
  await expect(recommendations.getByRole("button", { name: "关联推荐更多操作", exact: true })).toHaveCount(0);
  const toolbar = recommendations.getByRole("group", { name: "推荐操作", exact: true });
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar.getByRole("button", { name: "AI 精选", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "检查新论文", exact: true })).toBeVisible();
  const more = toolbar.getByRole("button", { name: "更多推荐操作", exact: true });
  await expect(more).toBeVisible();
  const bounds = (await toolbar.boundingBox())!;
  const buttons = await toolbar.getByRole("button").all();
  let previousRight = bounds.x;
  for (const button of buttons) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(previousRight);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(Math.abs(box.y + box.height / 2 - (bounds.y + bounds.height / 2))).toBeLessThan(2);
    previousRight = box.x + box.width;
  }
  expect(await recommendations.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await more.focus(); await more.press("Enter");
  await expect(page.getByRole("menuitem", { name: "推荐与文献服务设置", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
}

test("library action menus stay aligned with one recommendation toolbar", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/?pdf-highlight-fixture#library-folders");
  await expectLibraryActionLayout(page);
  await page.screenshot({ path: testInfo.outputPath("library-action-layout.png") });
});

test("folder drops highlight, persist imports, and move files back to root", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/?pdf-highlight-fixture#library-folders");
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  const folder = library.locator(".library-folder-row").filter({ has: page.getByRole("button", { name: "eBooks", exact: true }) });
  await expect(folder).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# Field Guide\n\nPersistent folder notes."], "guide.md", { type: "text/markdown" }));
    return transfer;
  });
  await folder.dispatchEvent("dragenter", { dataTransfer });
  await expect(folder).toHaveClass(/is-drop-target/);
  await expect(folder).toContainText("松开即可导入“eBooks”");
  await expect(folder).not.toHaveCSS("transform", "none");
  await expect(folder).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("folder-drop-light.png") });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("liteasy:appearance-change", { detail: "dark" })));
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await folder.hover();
  const expectedBlue = await folder.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--colorBrandBackground2)";
    element.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect(folder).toHaveCSS("background-color", expectedBlue);
  await expect(folder).toHaveClass(/is-drop-target/);
  await page.screenshot({ path: testInfo.outputPath("folder-drop-dark.png") });
  await folder.dispatchEvent("drop", { dataTransfer });
  const book = library.getByRole("button", { name: "选择文件 Field Guide" });
  await expect(book).toBeVisible();
  await expect(book.locator("xpath=ancestor::li[contains(@class,'library-folder-node')]")).toContainText("eBooks");
  await expect(folder).not.toHaveClass(/is-drop-target/);
  await expect(page.getByText("目标：eBooks。已导入 1 个文件。")).toBeVisible();
  await page.reload();
  await library.getByRole("button", { name: "展开eBooks" }).click();
  await expect(book).toBeVisible();
  await book.dragTo(library.getByRole("button", { name: /本地文献库/ }).first());
  await expect(page.getByText("文件已移入“本地文献库”。")).toBeVisible();
  await expect(book.locator("xpath=ancestor::li[contains(@class,'library-folder-node')]")).toHaveCount(0);
  await page.reload();
  await expect(book).toBeVisible();
  // Use a real browser drag of an existing file, then verify its new parent.
  await book.dragTo(folder);
  await expect(page.getByText("文件已移入“eBooks”。")).toBeVisible();
  await expect(book.locator("xpath=ancestor::li[contains(@class,'library-folder-node')]")).toContainText("eBooks");
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "更换图标" }).click();
  await page.getByRole("button", { name: "书籍", exact: true }).click();
  await expect(folder.locator("[data-icon]")).toHaveAttribute("data-icon", "book");
  await book.click({ button: "right" });
  await page.getByRole("menuitem", { name: "更换图标" }).click();
  await page.getByRole("button", { name: "星标", exact: true }).click();
  await expect(book.locator("[data-icon]")).toHaveAttribute("data-icon", "star");
  await page.reload();
  await expect(library.getByRole("button", { name: "收起eBooks" })).toBeVisible();
  await expect(book).toBeVisible();
  await expect(book.locator("[data-icon]")).toHaveAttribute("data-icon", "star");
  await expect(folder.locator("[data-icon]")).toHaveAttribute("data-icon", "book");
  await book.click({ button: "right" });
  await page.getByRole("menuitem", { name: "更换图标" }).click();
  await page.getByRole("button", { name: "恢复默认图标" }).click();
  await expect(book.locator("[data-icon]")).toHaveAttribute("data-icon", "code");
  await expectLibraryActionLayout(page);
  await page.screenshot({ path: testInfo.outputPath("library-icons-compact.png") });
});
