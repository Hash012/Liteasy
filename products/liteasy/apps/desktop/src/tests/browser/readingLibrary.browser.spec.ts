import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

function ebook() {
  return Buffer.from(zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "OEBPS/content.opf": strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Research Field Guide</dc:title><dc:creator>Lin Researcher</dc:creator><dc:identifier id="book-id">9781234567897</dc:identifier><dc:language>en</dc:language><dc:date>2024-03-01</dc:date><dc:publisher>Research Press</dc:publisher></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    "OEBPS/nav.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Foundations</a></li><li><a href="two.xhtml">Methods</a></li></ol></nav></body></html>'),
    "OEBPS/one.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Foundations</title></head><body><h1>Foundations</h1><p>Reliable evidence supports careful scientific reading.</p></body></html>'),
    "OEBPS/two.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Methods</title></head><body><h1>Methods</h1><p>Replication and uncertainty guide our methods.</p></body></html>')
  }));
}

test("imports real EPUB, Markdown and text, filters metadata and restores reading progress", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "书库与元信息", exact: true }).click();
  const library = page.getByRole("region", { name: "书库与元信息", exact: true });
  await expect(library.getByRole("button", { name: "导入文件" })).toBeEnabled();
  await library.getByLabel("选择阅读文件").setInputFiles([
    { name: "field-guide.epub", mimeType: "application/epub+zip", buffer: ebook() },
    { name: "research.md", mimeType: "text/markdown", buffer: Buffer.from("# Research Notes\n\nA readable formula: $E=mc^2$.\n\n## Next Steps\n\n- Inspect evidence\n- Check conclusions") },
    { name: "meeting.txt", mimeType: "text/plain", buffer: Buffer.from("A plain text research memo.\n\nPreserve the original text and paragraph spacing.") }
  ]);
  const table = library.getByRole("table", { name: "文献与文件列表" });
  await expect(table.getByRole("row")).toHaveCount(4);
  const search = library.getByRole("textbox", { name: "搜索文献与文件" });
  const commands = page.getByRole("toolbar", { name: "工作区命令栏" });
  await expect(commands).toContainText("书库与元信息");
  await commands.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toBeFocused();
  await search.fill("9781234567897");
  await expect(table.getByRole("row")).toHaveCount(2);
  await table.getByRole("row").filter({ hasText: "Research Field Guide" }).click();
  await expect(table.getByRole("cell", { name: "2024", exact: true })).toHaveCSS("white-space", "nowrap");
  const details = library.getByRole("complementary", { name: "文件元信息" });
  await expect(details.getByText("Lin Researcher", { exact: true })).toBeVisible();
  await expect(details.getByText("Research Press", { exact: true })).toBeVisible();
  await details.getByRole("textbox", { name: "文件分类" }).fill("Research Methods");
  await details.getByRole("textbox", { name: "文件标签" }).fill("classic, reading");
  await details.getByRole("button", { name: "保存整理信息" }).click();
  await page.screenshot({ path: testInfo.outputPath("reading-library-light.png"), fullPage: true, animations: "disabled" });
  await details.getByRole("button", { name: "开始阅读" }).click();
  const reading = library.getByLabel("文档阅读区域", { exact: true });
  await expect(reading.getByText("Reliable evidence supports careful scientific reading.")).toBeVisible();
  await library.getByRole("navigation", { name: "章节目录" }).getByRole("button", { name: "Methods", exact: true }).click();
  await expect(reading.getByText("Replication and uncertainty guide our methods.")).toBeVisible();
  await library.getByRole("button", { name: "阅读外观", exact: true }).click();
  await page.getByRole("combobox", { name: "阅读主题", exact: true }).selectOption("warm");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("epub-reader-warm.png"), fullPage: true, animations: "disabled" });
  await expect(commands).toContainText("Research Field Guide");
  await expect(page.getByLabel("文件状态栏", { exact: true })).toContainText("EPUB");
  await commands.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(library.getByRole("textbox", { name: "搜索书内文字" })).toBeFocused();
  await library.getByRole("textbox", { name: "搜索书内文字" }).fill("uncertainty");
  await expect(library.getByRole("status").filter({ hasText: "1 处匹配" })).toBeVisible();
  await library.getByRole("button", { name: "返回书库", exact: true }).click();
  await expect(search).toHaveValue("9781234567897");
  await details.getByRole("button", { name: "开始阅读" }).click();
  await expect(reading.getByText("Replication and uncertainty guide our methods.")).toBeVisible();
  await library.getByRole("button", { name: "返回书库", exact: true }).click();
  await search.fill("Research Notes");
  await table.getByRole("row").filter({ hasText: "Research Notes" }).dblclick();
  await expect(reading.locator(".katex").first()).toBeVisible();
  await library.getByRole("button", { name: "返回书库", exact: true }).click();
  await search.fill("meeting");
  await table.getByRole("row").filter({ hasText: "meeting" }).dblclick();
  await expect(reading.getByText(/Preserve the original text/)).toBeVisible();
  await library.getByRole("button", { name: "返回书库", exact: true }).click();
  await page.reload();
  await expect(library).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await search.fill("classic");
  await expect(table.getByRole("row")).toHaveCount(2);
  await table.getByRole("row").filter({ hasText: "Research Field Guide" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await page.screenshot({ path: testInfo.outputPath("reading-library-dark.png"), fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});
