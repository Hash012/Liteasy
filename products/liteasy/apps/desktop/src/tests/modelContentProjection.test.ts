import { expect, test } from "vitest";
import { modelContentProjection } from "../app/features/resource-filesystem/modelContentProjection";
import { readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
import { legacyContent } from "../app/features/markdown/contentFragment";
const asset = { path: "liteasy://objects/n?scope=local", kind: "content.note", title: "note", revision: "r1", capabilities: [] };
test("delivers a closed table with source ranges instead of the partial attribute requested", () => {
  const text = '<table><tr><th colspan="2">Header</th></tr><tr><td>A</td><td>B</td></tr></table>';
  const read = readAgentAssetText(asset, text, { offset: 22, maxCharacters: 2 });
  const projection = modelContentProjection(read, 1000);
  expect(read.text).toBe(text.slice(22, 24));
  expect(projection.text).toBe(text);
  expect(projection.deliveryRanges).toEqual([{ start: 0, end: text.length, unit: "utf16" }]);
  expect(modelContentProjection(read, 20)).toMatchObject({ text: "", contentFormat: "metadata-only", deliveryRanges: [] });
});
test("selects complete blocks within budget and preserves original CRLF/UTF16 mapping", () => {
  const text = '😀 short\r\n\r\n' + 'long sentence '.repeat(20);
  const read = readAgentAssetText(asset, text, { maxCharacters: 20 });
  const projection = modelContentProjection(read, 20);
  expect(projection.text).toBe('😀 short');
  expect(projection.deliveryRanges).toEqual([{ start: 0, end: 8, unit: "utf16" }]);
});
test("large legacy text retains original bytes with an explicit rendering budget", () => {
  const text = "long note ".repeat(30000);
  const content = legacyContent(text);
  expect(content.exactSelection.text).toBe(text);
  expect(content.viewContext.text).toBe("");
  expect(content.integrity).toBe("budget-exceeded");
});
