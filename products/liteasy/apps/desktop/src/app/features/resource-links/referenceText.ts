export type ReferenceHeading = { title: string; level: number; line: number; endLine: number; complete: boolean };
export type ReferenceRange = { start: number; end: number; text: string; fragment: string; label: string };
export function normalizeReferenceText(text: string) { return text.replace(/\r\n?/g, "\n"); }
export function referenceHeadings(text: string, complete = true): ReferenceHeading[] {
  const lines = normalizeReferenceText(text).split("\n");
  const headings: ReferenceHeading[] = [];
  let fence = "";
  lines.forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ""; return; }
    if (fence) return;
    const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const setext = index > 0 && lines[index - 1].trim() ? line.match(/^ {0,3}(=+|-+)\s*$/) : null;
    if (atx || setext) headings.push({ title: atx ? atx[2] : lines[index - 1].trim(), level: atx ? atx[1].length : setext![1][0] === "=" ? 1 : 2,
      line: atx ? index + 1 : index, endLine: lines.length, complete });
  });
  headings.forEach((heading, index) => {
    const next = headings.slice(index + 1).find((value) => value.level <= heading.level);
    if (next) { heading.endLine = next.line - 1; heading.complete = true; }
  });
  return headings;
}
export function referenceLines(text: string, start: number, end: number, complete = true): ReferenceRange {
  const lines = normalizeReferenceText(text).split("\n");
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lines.length || (!complete && end === lines.length)) {
    throw new Error("行范围无效或尚未完整载入，请继续载入内容后重新选择。");
  }
  return { start, end, text: lines.slice(start - 1, end).join("\n"), fragment: `L${start}:${end}`, label: `第 ${start}–${end} 行` };
}
export function referenceFragment(text: string, fragment: string, complete = true): ReferenceRange {
  const lines = normalizeReferenceText(text).split("\n");
  const range = fragment.match(/^L(\d+)(?::(\d+))?$/);
  if (range) return referenceLines(text, Number(range[1]), Number(range[2] ?? range[1]), complete);
  if (/^L\d|^page=/.test(fragment)) {
    const page = fragment.match(/^page=([1-9]\d*)$/);
    if (!page) throw new Error("位置格式无效，请使用 L1:3、标题或 page=12。");
    const index = lines.findIndex((line) => line.trim() === `第 ${page[1]} 页`);
    if (index < 0) throw new Error("此页正文尚未载入或没有提取文本。");
    const next = lines.findIndex((line, i) => i > index && /^第 \d+ 页$/.test(line.trim()));
    return { ...referenceLines(text, index + 1, next < 0 ? lines.length : next, complete), fragment, label: `第 ${page[1]} 页` };
  }
  if (fragment.startsWith("^")) {
    const index = lines.findIndex((line) => line.trim().endsWith(`^${fragment.slice(1)}`));
    if (index < 0) throw new Error("找不到这个块标识。");
    let start = index; while (start > 0 && lines[start - 1].trim()) start--;
    return { ...referenceLines(text, start + 1, index + 1, complete), fragment, label: fragment };
  }
  const matches = referenceHeadings(text, complete).filter((heading) => heading.title === fragment);
  if (matches.length !== 1) throw new Error(matches.length ? "存在同名标题，请在内容预览中选择具体行范围。" : "找不到这个标题，请继续载入或检查链接。");
  if (!matches[0].complete) throw new Error("此章节尚未完整载入，请继续载入后再选择。");
  return { ...referenceLines(text, matches[0].line, matches[0].endLine, complete), fragment, label: fragment };
}
export function headingReference(text: string, heading: ReferenceHeading, complete: boolean) {
  if (!heading.complete) throw new Error("此章节尚未完整载入，请继续载入后再选择。");
  const range = referenceLines(text, heading.line, heading.endLine, complete);
  return { ...range, fragment: referenceHeadings(text, complete).filter((item) => item.title === heading.title).length === 1 ? heading.title : range.fragment, label: heading.title };
}
export function splitReference(raw: string) {
  const [locator, ...labels] = raw.split("|");
  const hash = locator.indexOf("#");
  return { target: (hash < 0 ? locator : locator.slice(0, hash)).trim(), fragment: hash < 0 ? "" : decodeReference(locator.slice(hash + 1).trim()), label: labels.join("|").trim() };
}
export function decodeReference(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
export const referenceHref = (value: string) => `liteasy-reference:${encodeURIComponent(value)}`;
export const fromReferenceHref = (value: string) => value.startsWith("liteasy-reference:") ? decodeReference(value.slice(18)) : undefined;

/** Only the unfinished wiki under the caret, never a fenced/inline code example. */
export function activeWiki(text: string, caret: number) {
  const start = text.lastIndexOf("[[", caret - 1);
  if (start < 0 || caret < start + 2 || text.slice(start + 2, caret).includes("]]")) return undefined;
  const before = text.slice(0, start);
  if (before.endsWith("\\") || (before.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0) % 2 || (before.split("\n").at(-1)?.match(/`/g)?.length ?? 0) % 2) return undefined;
  const end = text.indexOf("]]", start + 2);
  if (end < caret || end - start > 8192 || /\n/.test(text.slice(start, end))) return undefined;
  return { start, end: end + 2, raw: text.slice(start + 2, end).trim() };
}
