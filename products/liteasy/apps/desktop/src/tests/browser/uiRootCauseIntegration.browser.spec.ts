import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("isolated AppShell keeps paper, note, Studio draft, assistant view and browser export consistent through reload", async ({ page }, info) => {
  test.setTimeout(120_000);
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", route => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  const modelRequests: string[] = [];
  await page.route(/\/(responses|chat\/completions)(?:[?/]|$)/, route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?pdf-highlight-fixture#importable");
  const firstPage = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(firstPage.locator(".pdf-text-layer")).not.toBeEmpty({ timeout: 30_000 });
  await page.screenshot({ path: info.outputPath("01-synthetic-paper.png") });

  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "新建笔记", exact: true }).click();
  await notes.getByRole("textbox", { name: "笔记正文", exact: true }).fill("联合验收笔记\n\nPR07_SYNTHETIC_NOTE：保留来源与段落，不调用模型。");
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  const note = notes.getByRole("button", { name: /查看笔记 联合验收笔记/ });
  await expect(note).toBeVisible();

  await page.getByRole("button", { name: "扩展", exact: true }).click();
  await page.getByRole("button", { name: "制作扩展", exact: true }).click();
  await page.getByRole("button", { name: "开始离线演示", exact: true }).click();
  const studio = page.locator(".workflow-studio");
  await studio.getByRole("button", { name: "研究问题", exact: true }).click();
  await studio.getByRole("textbox", { name: "卡片正文", exact: true }).fill("## 联合验收研究问题\n\nPR07_SYNTHETIC_CARD：比较保存后的真实预览。");
  await studio.getByRole("button", { name: "校验与预览", exact: true }).click();
  await expect(studio.locator(".studio-preview")).toContainText("PR07_SYNTHETIC_CARD");
  await studio.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(studio.getByText("演示已完成", { exact: true })).toBeVisible();

  const assistant = page.locator(".assistant-pane");
  await assistant.getByRole("button", { name: "新建", exact: true }).click();
  await expect(assistant.getByLabel("助手首页")).toBeVisible();
  await expect(assistant.getByRole("log", { name: "对话消息" })).toHaveCount(0);
  await expect(assistant.locator(".assistant-save-status")).toHaveCount(0);
  await assistant.getByRole("button", { name: "任务", exact: true }).click();
  await expect(assistant.getByLabel("历史会话面板")).toBeVisible();
  await expect(assistant.getByRole("log", { name: "对话消息" })).toHaveCount(0);
  await expect(assistant.getByPlaceholder("输入你的问题或命令")).toHaveCount(0);
  await assistant.getByRole("button", { name: "新建", exact: true }).click();
  await assistant.getByPlaceholder("输入你的问题或命令").fill("PR07_SYNTHETIC_DRAFT：仅保存草稿，不发送。");
  await expect(assistant.getByText("已保存到此浏览器", { exact: true })).toBeVisible();

  await nav.getByRole("button", { name: "笔记", exact: true }).click();
  await note.click();
  await expect(notes.getByRole("region", { name: "打开的笔记" })).toContainText("PR07_SYNTHETIC_NOTE");
  await notes.getByRole("button", { name: "导出阅读文档", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /导出：联合验收笔记/ });
  await dialog.getByRole("combobox", { name: "格式", exact: true }).selectOption("pdf");
  await dialog.getByRole("button", { name: "生成预览", exact: true }).click();
  await expect(dialog.getByText("文档结构预览；尚未生成可核验 PDF，保存由系统打印管理。")).toBeVisible();
  await expect(dialog.frameLocator('iframe[title="导出文档结构预览"]').locator("body")).toContainText("PR07_SYNTHETIC_NOTE");
  await expect(dialog.getByRole("button", { name: "系统打印", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("02-browser-export-structure.png") });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: info.outputPath("03-three-column-workflow.png") });

  await page.reload();
  await expect(assistant.getByPlaceholder("输入你的问题或命令")).toHaveValue("PR07_SYNTHETIC_DRAFT：仅保存草稿，不发送。");
  await expect(note).toBeVisible(); await note.click();
  await expect(notes.getByRole("region", { name: "打开的笔记" })).toContainText("PR07_SYNTHETIC_NOTE");
  await page.getByRole("button", { name: "扩展", exact: true }).click();
  await page.getByRole("button", { name: "制作扩展", exact: true }).click();
  await page.locator(".studio-more > summary").click();
  await page.getByLabel("选择扩展草稿").selectOption({ label: "离线演示：四张研究卡片" });
  await studio.getByRole("button", { name: "研究问题", exact: true }).click();
  await expect(studio.getByRole("textbox", { name: "卡片正文", exact: true })).toHaveValue("## 联合验收研究问题\n\nPR07_SYNTHETIC_CARD：比较保存后的真实预览。");
  await expect(studio.locator(".studio-card-list button")).toHaveCount(4);
  expect(modelRequests).toEqual([]);
  await page.screenshot({ path: info.outputPath("04-restored-canonical-draft.png") });
});
