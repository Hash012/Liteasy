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
  await notes.getByRole("button", { name: "新建目录", exact: true }).click();
  await notes.getByRole("textbox", { name: "目录名称" }).fill("检索研究");
  await notes.getByRole("button", { name: "创建目录", exact: true }).click();
  await expect(
    notes.getByRole("button", { name: "检索研究", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await notes
    .getByRole("button", { name: "default/note", exact: true })
    .click();
  await entry.click();
  await notes
    .getByRole("button", { name: "复制引用到目录", exact: true })
    .click();
  await notes
    .getByRole("combobox", { name: "复制引用到目录" })
    .selectOption({ label: "Note/检索研究" });
  await notes.getByRole("button", { name: "复制引用", exact: true }).click();
  await expect(
    notes.getByRole("combobox", { name: "复制引用到目录" }),
  ).toHaveCount(0);
  await notes.getByRole("button", { name: "检索研究", exact: true }).click();
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
  await notes.getByRole("button", { name: "检索研究", exact: true }).click();
  await expect(entry).toHaveCount(1);
  await expect(notes).toContainText("补充：保留失败案例以评估边界。");
  await notes.getByRole("button", { name: /笔记操作 研究问题/ }).click();
  await page
    .getByRole("menuitem", { name: "移除目录引用", exact: true })
    .click();
  await expect(entry).toHaveCount(0);
  await notes
    .getByRole("button", { name: "default/note", exact: true })
    .click();
  await expect(entry).toHaveCount(1);
  await expect(notes).toContainText("补充：保留失败案例以评估边界。");
});
