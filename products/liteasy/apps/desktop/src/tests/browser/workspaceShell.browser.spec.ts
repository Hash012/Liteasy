import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "工作区命令栏" });
const status = (page: Page) => page.getByLabel("文件状态栏", { exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "左边栏导航" });

async function expectGeometry(page: Page) {
  const top = (await toolbar(page).boundingBox())!;
  const bottom = (await status(page).boundingBox())!;
  const workspace = (await page.getByTestId("workbench-layout").boundingBox())!;
  expect(top.y).toBe(0);
  expect(top.height).toBe(40);
  expect(bottom.height).toBe(26);
  expect(bottom.y + bottom.height).toBe(page.viewportSize()!.height);
  expect(workspace.y).toBe(top.height);
  expect(workspace.y + workspace.height).toBe(bottom.y);
  expect(await toolbar(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

test("shell stays fixed across Library, Settings and Notes; history and contextual search work", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(toolbar(page)).toContainText("文献库");
  await expectGeometry(page);
  await expect(status(page)).toHaveText("Liteasy · 就绪");
  await page.screenshot({ path: testInfo.outputPath("after-library.png"), animations: "disabled" });
  await toolbar(page).getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索文献资源" })).toBeFocused();
  const columns = await page.locator(".dock-workspace-columns").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  await nav(page).getByRole("button", { name: "设置", exact: true }).click();
  await expect(toolbar(page)).toContainText("设置");
  await expectGeometry(page);
  await expect(status(page)).toHaveText("Liteasy · 就绪");
  await expect(toolbar(page).getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("after-settings.png"), animations: "disabled" });
  await nav(page).getByRole("button", { name: "笔记", exact: true }).click();
  await expect(toolbar(page)).toContainText("笔记");
  await expectGeometry(page);
  expect(await page.locator(".dock-workspace-columns").evaluate((element) => getComputedStyle(element).gridTemplateColumns)).toBe(columns);
  await toolbar(page).getByRole("button", { name: "后退", exact: true }).click();
  await expect(toolbar(page)).toContainText("设置");
  await toolbar(page).getByRole("button", { name: "前进", exact: true }).click();
  await expect(toolbar(page)).toContainText("笔记");
  await toolbar(page).getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索笔记" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("after-notes.png"), animations: "disabled" });
});

test("commands overflow without wrapping, keep accessible names, and retain the existing pane controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const layout = toolbar(page).getByRole("button", { name: "布局", exact: true });
  await layout.hover();
  await expect(page.getByRole("tooltip", { name: "布局", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 400, height: 740 });
  await expect(layout).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "搜索", exact: true })).toBeVisible();
  await expectGeometry(page);
  await toolbar(page).getByRole("button", { name: "更多工作区操作" }).click();
  await page.getByRole("menuitem", { name: "布局", exact: true }).click();
  const right = page.getByRole("menuitemcheckbox", { name: "右侧栏", exact: true });
  await expect(right).toBeChecked();
  await right.click();
  await expect(page.locator('.dock-workspace-columns > [data-region="right"]')).toHaveCount(0);
  await page.locator(".shell-workspace-title").click();
  await expectGeometry(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(toolbar(page).getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
  await toolbar(page).getByRole("button", { name: "更多工作区操作" }).click();
  await expect(page.getByRole("menuitem", { name: "搜索", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(toolbar(page)).toContainText("设置");
  await expectGeometry(page);
  await page.screenshot({ path: testInfo.outputPath("after-narrow.png"), animations: "disabled" });
});

test("active PDF metadata follows focus and closing the document clears it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const bytes = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: bytes, contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(page.locator(".pdf-text-layer").first()).toContainText("alpha", { timeout: 30000 });
  await expect(toolbar(page)).toContainText("das24a.pdf");
  await expect(status(page)).toContainText("PDF · 1 页 · 667 B · 本地");
  await expectGeometry(page);
  await page.screenshot({ path: testInfo.outputPath("after-pdf.png"), animations: "disabled" });
  await toolbar(page).getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索文档内容" })).toBeVisible();
  await nav(page).getByRole("button", { name: "设置", exact: true }).click();
  await expect(status(page)).toHaveText("Liteasy · 就绪");
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  await expect(status(page)).toContainText("PDF · 1 页");
  await page.getByRole("button", { name: "关闭 das24a.pdf", exact: true }).click();
  await expect(status(page)).toHaveText("Liteasy · 就绪");
  await expectGeometry(page);
});

test("shell inherits live Fluent light/dark tokens and truncates a long title", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 460 });
  await page.goto("/src/tests/browser/fixtures/workspace-shell.html");
  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page)).toHaveCSS("background-color", "rgb(245, 245, 245)");
  expect(await page.locator(".shell-workspace-title").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(toolbar(page).getByRole("button", { name: "布局", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "切换测试主题" }).click();
  await expect(toolbar(page)).toHaveCSS("background-color", "rgb(20, 20, 20)");
  await expect(status(page)).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await expect(toolbar(page)).toHaveCSS("color", "rgb(214, 214, 214)");
  await toolbar(page).getByRole("button", { name: "更多工作区操作" }).click();
  const settings = page.getByRole("menuitem", { name: "设置", exact: true });
  await expect(settings).toBeVisible();
  expect(await settings.evaluate((element) => getComputedStyle(element).getPropertyValue("--colorNeutralBackground1").trim())).toBe("#292929");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("shell-dark.png"), animations: "disabled" });
  await page.getByRole("button", { name: "切换测试主题" }).click();
  await expect(toolbar(page)).toHaveCSS("background-color", "rgb(245, 245, 245)");
});

test("an imported note supplies document metadata and a long title without shifting commands", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 740 });
  await page.goto("/");
  await nav(page).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  const name = "Lairmar - Large Language Models with Episodic Memory Control and an extended research notebook title.md";
  const chooser = page.waitForEvent("filechooser");
  await notes.getByRole("button", { name: "导入 Markdown 文件", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "text/markdown", buffer: Buffer.from("# Research\n\nEvidence and questions.") });
  await notes.getByRole("button", { name: `查看笔记 ${name}`, exact: true }).click();
  await expect(toolbar(page)).toContainText(name);
  // Import creates a repository note; it is not a live external-file binding.
  await expect(status(page)).toContainText("笔记");
  await expect(status(page)).toContainText("修改于");
  await page.setViewportSize({ width: 640, height: 740 });
  await expectGeometry(page);
  expect(await page.locator(".shell-workspace-title").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(toolbar(page).getByRole("button", { name: "更多工作区操作" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("after-note-document.png"), animations: "disabled" });
});
