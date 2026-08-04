/**
 * Joins a pdf.js text layer back into readable page text.
 *
 * pdf.js hands back one item per run of glyphs, and in CJK documents that is frequently one item
 * *per character*. Joining unconditionally with a space therefore produced text like
 * "框 架 理 论 发 展" — observed on a real CNKI paper, whose DOI line came out as
 * "DOI : 1 0 ． 1 3 4 9 5". Everything downstream reads that page text, so the damage compounds:
 * anchor discovery's patterns no longer match, `[12]` becomes `[1 2]` and parses as no citation at
 * all, and highlighting cannot find the quote it was given.
 *
 * The rule is deliberately narrow. A space is inserted only where a space could belong — between
 * two items that are not both part of CJK writing, which does not separate characters with spaces.
 * Latin behaviour is untouched, because that is where the existing spacing was already correct.
 */

/** CJK ideographs, kana, Hangul, and the full-width punctuation that travels with them. */
const cjkPattern =
  /[⺀-〿぀-ヿ㄰-㆏㐀-䶿一-鿿ꀀ-꓏가-힯豈-﫿︰-﹏＀-￯]/u;

export type PdfTextItem = {
  hasEOL?: boolean;
  str?: string;
};

function isTextItem(item: unknown): item is PdfTextItem {
  return Boolean(item) && typeof item === "object" && typeof (item as PdfTextItem).str === "string";
}

/**
 * True when no separator belongs between these two neighbours.
 *
 * Two signals, because one is not enough. **CJK on either edge** keeps mixed runs intact — a
 * sentence split into "框架" / "35" / "年" must not gain spaces around the digits. And **both items
 * being a single character** catches per-glyph delivery whatever the script, which is what turned
 * a citation marker into "[ 1 2 ]" — ASCII on both sides, so the CJK rule could not see it, and
 * `[1 2]` parses as no citation at all.
 *
 * A genuine one-letter Latin word between two others would lose its space. That is rare, and the
 * alternative — leaving every bracketed citation in a Chinese paper unparseable — is not a trade
 * worth making.
 */
function shouldJoinDirectly(left: string, right: string) {
  if (!left || !right) {
    return true;
  }
  if (/\s$/u.test(left) || /^\s/u.test(right)) {
    return true;
  }
  if (left.length === 1 && right.length === 1) {
    return true;
  }
  return cjkPattern.test(left.slice(-1)) || cjkPattern.test(right.slice(0, 1));
}

export function joinPdfTextItems(items: readonly unknown[]): string {
  const parts: string[] = [];
  let previous = "";
  for (const item of items) {
    if (!isTextItem(item)) {
      continue;
    }
    const text = item.str ?? "";
    if (parts.length > 0 && !shouldJoinDirectly(previous, text)) {
      parts.push(" ");
    }
    parts.push(text);
    // A line break is a real separator whatever the script, so the next item starts fresh.
    if (item.hasEOL) {
      parts.push("\n");
      previous = "\n";
      continue;
    }
    previous = text || previous;
  }
  return parts.join("");
}

/**
 * One canonical page-text representation for extraction, persisted offsets, and rendering.
 * Keeping this at the PDF boundary prevents a background import and a later reader render from
 * producing two different coordinate systems for the same page.
 */
export function normalizePdfPageText(value: string) {
  return value
    .replace(/-\s*\n\s*(?=[a-z])/g, "")
    .replace(/\u00ad\s*\n?\s*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
