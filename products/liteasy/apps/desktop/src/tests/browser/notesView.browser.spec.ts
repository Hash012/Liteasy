import { expect, test } from "@playwright/test";

test("Notes organizes references, edits the source once and persists after reopening", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await expect(notes).toBeVisible();
  await notes.getByRole("button", { name: "新建笔记", exact: true }).click();
  await notes
    .getByRole("textbox", { name: "笔记正文" })
    .fill(
      "研究问题：比较不同检索方法的证据覆盖。\n需要记录实验设置与失败案例。",
    );
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  const entry = notes.getByRole("button", { name: /查看笔记 研究问题/ });
  await expect(entry).toHaveCount(1);
  await notes.getByRole("button", { name: "更多笔记操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建目录", exact: true }).click();
  await notes.getByRole("textbox", { name: "目录名称" }).fill("检索研究");
  await notes.getByRole("button", { name: "创建目录", exact: true }).click();
  await expect(
    notes.getByRole("treeitem", { name: "检索研究", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await notes
    .getByRole("treeitem", { name: "Liteasy/个人笔记", exact: true })
    .click();
  await entry.click();
  await notes
    .getByRole("button", { name: "复制引用到目录", exact: true })
    .click();
  await notes
    .getByRole("combobox", { name: "复制引用到目录" })
    .click();
  await page.getByRole("option", { name: "Note/ 检索研究", exact: true }).click();
  await notes.getByRole("button", { name: "复制引用", exact: true }).click();
  await expect(
    notes.getByRole("combobox", { name: "复制引用到目录" }),
  ).toHaveCount(0);
  await notes.getByRole("treeitem", { name: "检索研究", exact: true }).click();
  await expect(entry).toHaveCount(1);
  await entry.click();
  await notes.getByRole("button", { name: "编辑笔记", exact: true }).click();
  await notes
    .getByRole("textbox", { name: "笔记正文" })
    .fill(
      "研究问题：比较不同检索方法的证据覆盖。\n补充：保留失败案例以评估边界。",
    );
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  await expect(notes).toContainText("补充：保留失败案例以评估边界。");
  await page.screenshot({
    path: testInfo.outputPath("notes-view.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(notes).toBeVisible();
  await notes.getByRole("treeitem", { name: "检索研究", exact: true }).click();
  await expect(entry).toHaveCount(1);
  await entry.click();
  await expect(notes).toContainText("补充：保留失败案例以评估边界。");
  await notes.getByRole("button", { name: /笔记操作 研究问题/ }).click();
  await page
    .getByRole("menuitem", { name: "移除目录引用", exact: true })
    .click();
  await expect(entry).toHaveCount(0);
  await notes
    .getByRole("treeitem", { name: "Liteasy/个人笔记", exact: true })
    .click();
  await expect(entry).toHaveCount(1);
  await entry.click();
  await expect(notes).toContainText("补充：保留失败案例以评估边界。");
});


test("Notes shows grouped excerpts and expands details at the selected row on narrow screens", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  for (const title of ["论文方法", "实验记录", "待验证问题"]) {
    await notes.getByRole("button", { name: "新建笔记", exact: true }).click();
    await notes.getByRole("textbox", { name: "笔记正文" }).fill(`${title}\n\n**关键术语**与来源依据。\n\n- 保留证据\n- 核对实验`);
    await notes.getByRole("button", { name: "保存", exact: true }).click();
    await expect(notes.getByRole("button", { name: `查看笔记 ${title}`, exact: true })).toBeVisible();
  }
  await expect(notes.getByRole("heading", { name: /个人笔记/ })).toBeVisible();
  await notes.getByRole("combobox", { name: "笔记排序" }).click();
  await page.getByRole("option", { name: "标题", exact: true }).click();
  const target = notes.getByRole("button", { name: "查看笔记 实验记录", exact: true });
  await target.click();
  const row = target.locator("xpath=ancestor::article");
  await expect(row.getByRole("region", { name: "打开的笔记" })).toBeVisible();
  await expect(notes.locator(".notes-item-excerpt strong").first()).toHaveText("关键术语");
  await notes.locator(".notes-content").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("notes-grouped-detail.png"), animations: "disabled" });
  await page.setViewportSize({ width: 2048, height: 1718 });
  await notes.locator(".notes-content").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("notes-review-s1-2048x1718.png"), animations: "disabled" });
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(row.getByRole("region", { name: "打开的笔记" })).toBeVisible();
  expect(await notes.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("notes-narrow-detail.png"), animations: "disabled" });
});
