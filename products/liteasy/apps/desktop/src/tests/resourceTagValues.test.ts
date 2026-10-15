import { expect, test } from "vitest";
import { normalizeResourceTags, parseResourceTags, splitResourceTags } from "../app/features/resource-tags/resourceTagValues";

test("tags preserve display spelling while matching Unicode, case and whitespace variants", () => {
  expect(splitResourceTags(" RAG，rag；ＲＡＧ\ncafe\u0301, café;向量   检索, 向量 检索")).toEqual(["RAG", "café", "向量 检索"]);
});

test("reading preserves legacy overflow but writes report limits without truncation", () => {
  const tags = Array.from({ length: 51 }, (_, index) => `tag-${index}`);
  expect(normalizeResourceTags(tags)).toEqual(tags);
  expect(() => parseResourceTags(tags)).toThrow("最多添加 50 个标签");
  expect(() => parseResourceTags(["a".repeat(61)])).toThrow("每个标签最多 60 个字符");
});
