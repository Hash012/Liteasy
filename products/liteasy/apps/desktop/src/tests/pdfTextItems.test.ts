import { joinPdfTextItems } from "../app/features/pdf/pdfTextItems";

function items(...values: Array<string | { hasEOL?: boolean; str: string }>) {
  return values.map((value) => (typeof value === "string" ? { str: value } : value));
}

test("does not put a space between Chinese characters delivered as separate items", () => {
  // pdf.js splits CJK runs per glyph, which is how a real CNKI paper's title came out as
  // "框 架 理 论 发 展" and stopped every pattern downstream from matching.
  expect(joinPdfTextItems(items("框", "架", "理", "论", "发", "展"))).toBe("框架理论发展");
});

test("keeps digits and units inside a Chinese run unseparated", () => {
  expect(joinPdfTextItems(items("发", "展", "35", "年", "文", "献"))).toBe("发展35年文献");
});

test("reproduces the DOI line that exposed the bug", () => {
  const line = joinPdfTextItems(items(
    "DOI", "：", "1", "0", "．", "1", "3", "4", "9", "5", "／", "j", "．", "cnki"
  ));

  expect(line).toBe("DOI：10．13495／j．cnki");
});

test("still separates Latin words that arrive as separate items", () => {
  expect(joinPdfTextItems(items("Attention", "is", "all", "you", "need")))
    .toBe("Attention is all you need");
});

test("does not double a space the item already carries", () => {
  expect(joinPdfTextItems(items("Attention ", "is ", "all"))).toBe("Attention is all");
});

test("treats an end-of-line marker as a real break in any script", () => {
  expect(joinPdfTextItems(items({ hasEOL: true, str: "第一行" }, "第二行")))
    .toBe("第一行\n第二行");
  expect(joinPdfTextItems(items({ hasEOL: true, str: "First line" }, "Second line")))
    .toBe("First line\nSecond line");
});

test("keeps a citation marker parseable instead of splitting its number", () => {
  // "[1 2]" parses as no citation at all, which silently emptied every anchor's local subset.
  expect(joinPdfTextItems(items("自注意力", "[", "1", "2", "]", "机制"))).toBe("自注意力[12]机制");
});

test("ignores entries that are not text items", () => {
  expect(joinPdfTextItems([{ str: "alpha" }, null, undefined, { width: 3 }, { str: "beta" }]))
    .toBe("alpha beta");
});

test("joins single characters even in Latin, because that is per-glyph delivery", () => {
  // The cost of the rule, stated outright: a real one-letter word loses its space. Worth it
  // against leaving every citation marker in a CJK paper unparseable.
  expect(joinPdfTextItems(items("A", "t", "t", "n"))).toBe("Attn");
  expect(joinPdfTextItems(items("I", "am", "here"))).toBe("I am here");
});

test("returns an empty string for an empty page rather than throwing", () => {
  expect(joinPdfTextItems([])).toBe("");
});
