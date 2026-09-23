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

test("the original library stores all formats and shows selection metadata in the bottom bar", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await expect(nav.getByRole("button", { name: "书库与元信息" })).toHaveCount(0);
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  await expect(library.getByRole("button", { name: "导入文件", exact: true })).toBeEnabled();
  await library.getByLabel("选择文献库文件").setInputFiles([
    { name: "field-guide.epub", mimeType: "application/epub+zip", buffer: ebook() },
    { name: "research.md", mimeType: "text/markdown", buffer: Buffer.from("# Research Notes\n\nA readable formula: $E=mc^2$.") },
    { name: "meeting.txt", mimeType: "text/plain", buffer: Buffer.from("A plain text research memo.\n\nPreserve the original text and paragraph spacing.") },
    { name: "experiment.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0, 255, 128, 23]) }
  ]);
  const files = library.getByRole("list", { name: "文献库文件" });
  await expect(files.getByRole("listitem")).toHaveCount(4);
  const search = page.getByRole("textbox", { name: "搜索文献资源" });
  await search.fill("9781234567897");
  await expect(files.getByRole("listitem")).toHaveCount(1);
  const book = files.getByRole("button", { name: "选择文件 Research Field Guide", exact: true });
  await book.click();
  const bottom = page.getByLabel("文件状态栏", { exact: true });
  await expect(bottom).toContainText("Research Field Guide");
  await expect(bottom).toContainText("Lin Researcher");
  await expect(bottom).toContainText("2024");
  await bottom.getByRole("button", { name: "展开文件元信息" }).click();
  const details = page.getByRole("complementary", { name: "文件元信息" });
  await expect(details.getByText("Research Press", { exact: true })).toBeVisible();
  await details.getByRole("textbox", { name: "文件分类" }).fill("Research Methods");
  await details.getByRole("textbox", { name: "文件标签" }).fill("classic, reading");
  await details.getByRole("button", { name: "保存整理信息" }).click();
  await expect(details.getByRole("status")).toContainText("已保存");
  await page.screenshot({ path: testInfo.outputPath("unified-library-metadata.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await book.dblclick();
  const reader = page.getByRole("region", { name: "文件阅读器", exact: true });
  const reading = reader.getByLabel("文档阅读区域", { exact: true });
  await expect(reading.getByText("Reliable evidence supports careful scientific reading.")).toBeVisible();
  await expect(bottom).toContainText("EPUB");
  await reader.getByRole("navigation", { name: "章节目录" }).getByRole("button", { name: "Methods", exact: true }).click();
  await expect(reading.getByText("Replication and uncertainty guide our methods.")).toBeVisible();
  await page.getByRole("toolbar", { name: "工作区命令栏" }).getByRole("button", { name: "搜索", exact: true }).click();
  await expect(reader.getByRole("textbox", { name: "搜索书内文字" })).toBeFocused();
  await reader.getByRole("button", { name: "返回文献库", exact: true }).click();
  await expect(search).toHaveValue("9781234567897");
  await book.dblclick();
  await expect(reading.getByText("Replication and uncertainty guide our methods.")).toBeVisible();
  await reader.getByRole("button", { name: "返回文献库", exact: true }).click();
  await search.fill("Research Notes");
  await files.getByRole("button", { name: "选择文件 Research Notes", exact: true }).dblclick();
  await expect(reading.locator(".katex").first()).toBeVisible();
  await reader.getByRole("button", { name: "返回文献库", exact: true }).click();
  await search.fill("meeting");
  await files.getByRole("button", { name: "选择文件 meeting", exact: true }).dblclick();
  await expect(reading.getByText(/Preserve the original text/)).toBeVisible();
  await reader.getByRole("button", { name: "返回文献库", exact: true }).click();
  await search.fill("experiment");
  const downloaded = page.waitForEvent("download");
  await files.getByRole("button", { name: "选择文件 experiment.bin", exact: true }).dblclick();
  expect((await downloaded).suggestedFilename()).toBe("experiment.bin");
  await page.reload();
  await expect(files.getByRole("listitem")).toHaveCount(4);
  await search.fill("classic");
  await expect(files.getByRole("listitem")).toHaveCount(1);
  await book.click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await page.screenshot({ path: testInfo.outputPath("unified-library-dark.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
