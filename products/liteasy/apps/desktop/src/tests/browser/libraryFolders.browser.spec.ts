import { expect, test } from "@playwright/test";

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
  for (const name of ["收藏", "关联推荐"]) {
    const header = page.getByRole("region", { name, exact: true }).locator(".library-section-header-row");
    const heading = await header.locator(".library-section-header").boundingBox();
    const actions = await header.locator(".library-section-actions").boundingBox();
    expect(heading).not.toBeNull(); expect(actions).not.toBeNull();
    expect(Math.abs((heading!.y + heading!.height / 2) - (actions!.y + actions!.height / 2))).toBeLessThan(2);
  }
  await page.screenshot({ path: testInfo.outputPath("library-icons-compact.png") });
});
