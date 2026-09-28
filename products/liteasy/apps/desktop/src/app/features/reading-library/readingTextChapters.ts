import { readingFileLimits } from "./readingArchive";
import type { ReadingChapter } from "./readingDocument.types";

/** Section at headings and bounded paragraph/line boundaries, keeping ordinary fenced blocks together. */
export function textChapters(text: string, title: string, markdown: boolean) {
  const chapters: ReadingChapter[] = [];
  let lines: string[] = [];
  let size = 0;
  let heading = title;
  let fence: string | undefined;
  const flush = () => {
    const content = lines.join("\n").trim();
    if (content) chapters.push({ id: `chapter-${chapters.length + 1}`, title: heading, content, plainText: content, format: markdown ? "markdown" : "text" });
    lines = [];
    size = 0;
    if (chapters.length > readingFileLimits.chapters) throw new Error("文档章节过多，请拆分后导入。");
  };
  for (const line of text.split("\n")) {
    const fenceMatch = markdown ? line.match(/^ {0,3}(`{3,}|~{3,})/) : null;
    const section = !fence ? (markdown ? line.match(/^ {0,3}#{1,2}\s+(.+?)\s*#*$/) : line.match(/^\s*((?:第[\d一二三四五六七八九十百千零〇]+[章节部卷篇]|chapter\s+\d+).{0,80})$/i)) : null;
    if (section && lines.length) flush();
    if (section) heading = section[1].trim();
    if (size > readingFileLimits.chapterCharacters && !fence && !line.trim()) { flush(); heading = `${title} · ${chapters.length + 1}`; }
    // A single pathological line/fence cannot produce an unbounded React/Markdown tree.
    for (let start = 0; start < Math.max(line.length, 1); start += readingFileLimits.chapterCharacters) {
      if (size > readingFileLimits.chapterCharacters * 2) { flush(); heading = `${title} · ${chapters.length + 1}`; }
      const part = line.slice(start, start + readingFileLimits.chapterCharacters);
      lines.push(part); size += part.length + 1;
    }
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
    }
  }
  flush();
  if (!chapters.length) chapters.push({ id: "chapter-1", title, content: "", plainText: "", format: markdown ? "markdown" : "text" });
  return chapters;
}
