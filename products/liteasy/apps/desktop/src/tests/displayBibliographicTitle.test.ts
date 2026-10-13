import { expect, test, vi } from "vitest";
import { displayBibliographicTitle } from "../app/features/metadata/displayBibliographicTitle";

test.each([
  ["<p>Alpha</p>", "Alpha"], ["<p>A</p><p>B</p>", "A B"],
  ["A &amp; B", "A & B"], ["x < y", "x < y"],
  ["x<sup>2</sup>", "x^(2)"], ["H<sub>2</sub>O", "H_(2)O"],
  ["<jats:title>中文 <italic>研究</italic></jats:title>", "中文 研究"],
  ["<math><mi>x</mi><mo>+</mo><mi>α</mi></math>", "x+α"],
  ["<script>alert(1)</script><img src='https://example.test/pixel'>Title", "Title"],
  ["&lt;p&gt;A &amp;amp; B&lt;/p&gt;", "A & B"], [" \n\t ", ""],
])("renders inert readable title %s", (raw, expected) => {
  expect(displayBibliographicTitle(raw)).toBe(expected);
  expect(displayBibliographicTitle(displayBibliographicTitle(raw))).toBe(expected);
});
test("works without a DOM and bounds output without mutating source records", () => {
  vi.stubGlobal("DOMParser", undefined);
  try {
    const record = Object.freeze({ id: "raw-id", title: "<p>中文 &amp; Alpha</p>", evidence: "unchanged" });
    expect(displayBibliographicTitle(record.title)).toBe("中文 & Alpha");
    expect(record.title).toBe("<p>中文 &amp; Alpha</p>");
    expect(displayBibliographicTitle("a".repeat(200_000))).toHaveLength(4000);
  } finally { vi.unstubAllGlobals(); }
});
