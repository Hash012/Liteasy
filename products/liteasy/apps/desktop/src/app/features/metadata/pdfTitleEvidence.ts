type PositionedText = { str: string; height: number; width: number; transform: number[] };

/** A title search hint from the largest adjoining lines on the upper title page. */
export function extractPdfTitleHint(items: readonly unknown[], pageHeight: number): string | undefined {
  const lines: Array<{ y: number; size: number; items: PositionedText[] }> = [];
  for (const value of items) {
    const item = value as Partial<PositionedText>;
    if (!item.str?.trim() || !item.transform || !item.height || item.width === undefined) continue;
    // Ignore the rotated arXiv stamp and small print at the foot of the page.
    if (Math.abs(item.transform[1]) > Math.abs(item.transform[0]) || item.transform[5] < pageHeight * 0.45) continue;
    const text = item as PositionedText;
    const line = lines.find((row) => Math.abs(row.y - text.transform[5]) <= Math.max(2, text.height * 0.2));
    if (line) { line.items.push(text); line.size = Math.max(line.size, text.height); }
    else lines.push({ y: text.transform[5], size: text.height, items: [text] });
  }
  const rows = lines.sort((left, right) => right.y - left.y).map((line) => {
    let text = "";
    let previous: PositionedText | undefined;
    for (const item of line.items.sort((left, right) => left.transform[4] - right.transform[4])) {
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      // Small capitals and formula runs belong to one word when their glyph boxes touch.
      text += `${text && gap > Math.min(previous!.height, item.height) * 0.15 ? " " : ""}${item.str}`;
      previous = item;
    }
    return { ...line, text: text.trim() };
  });
  const eligible = rows.filter((line) => line.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 8 &&
    !/^(?:arxiv|abstract|references|a preprint|published as|provided proper|noname manuscript)\b/i.test(line.text));
  if (!eligible.length) return undefined;
  const titleLine = eligible.reduce((best, line) => line.size > best.size ? line : best);
  const start = rows.indexOf(titleLine);
  const titleRows = [titleLine.text];
  let previous = titleLine;
  for (const row of rows.slice(start + 1, start + 4)) {
    if (row.size < titleLine.size * 0.75 || previous.y - row.y > titleLine.size * 1.6 ||
      /^(?:abstract|a preprint)\b/i.test(row.text) || row.text.includes("@")) break;
    titleRows.push(row.text);
    previous = row;
  }
  return titleRows.join("\n").replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim().slice(0, 350) || undefined;
}
