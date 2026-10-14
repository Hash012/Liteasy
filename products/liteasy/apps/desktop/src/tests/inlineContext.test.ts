import { describe, expect, test } from "vitest";
import { inlineContextParts, insertContextNames, insertContextMentions, mapContextMentions, adaptContextMentions } from "../app/features/assistant/inlineContext";
import type { AssistantContextToken } from "../app/features/assistant/assistant.types";

const note: AssistantContextToken = { id: "note", label: "CicN", kind: "object", prompt: "",
  contextRefs: [{ objectId: "note", revision: "v1" }] };

describe("inline context names", () => {
  test("inserts at the caret and replaces a selected mention without losing surrounding text", () => {
    expect(insertContextNames("往 里面写入 hello", [note], { input: "往 里面写入 hello", start: 2, end: 2 }))
      .toEqual({ input: "往 CicN 里面写入 hello", caret: 7 });
    expect(insertContextNames("往 @Ci 里面写入 hello", [note], { input: "往 @Ci 里面写入 hello", start: 2, end: 5 }).input)
      .toBe("往 CicN 里面写入 hello");
    expect(insertContextNames("往旧笔记里面写入", [note], { input: "往旧笔记里面写入", start: 1, end: 4 }).input)
      .toBe("往 CicN 里面写入");
  });

  test("keeps whitespace and includes real names without markup or trigger prefixes", () => {
    const input = "第一行\n\n往  里面写入";
    expect(insertContextNames(input, [{ ...note, label: "@CicN" }, { ...note, label: "论文原文" }],
      { input, start: 8, end: 8 }).input).toBe("第一行\n\n往  CicN 论文原文 里面写入");
  });

  test("preserves typing before and after the original insertion while resources resolve", () => {
    const insertion = { input: "往 @Ci 里面写入", start: 2, end: 5 };
    expect(insertContextNames("请往 @Ci 里面写入", [note], insertion).input).toBe("请往 CicN 里面写入");
    expect(insertContextNames("往 @Ci 里面写入 hello", [note], insertion).input).toBe("往 CicN 里面写入 hello");
    expect(insertContextNames("往 hello", [note], { input: "往 ", start: 2, end: 2 }).input).toBe("往 CicN hello");
    expect(insertContextNames("往 改写内容 里面写入", [note], insertion).input).toBe("往 改写内容 CicN 里面写入");
  });

  test("ordinary names never become references, including ambiguous legacy drafts", () => {
    expect(inlineContextParts("CicN", [note])).toEqual([{ text: "CicN" }]);
    expect(inlineContextParts("CicN", [note, { ...note, id: "other" }])).toEqual([{ text: "CicN" }]);
  });
});


test("same labels preserve independent identities and multiple explicit mentions", () => {
  const first = insertContextMentions("比较 ", [], [note, { ...note, id: "second", contextRefs: [{ objectId: "other", revision: "v2" }] }], { input: "比较 ", start: 3, end: 3 });
  expect(inlineContextParts(first.input, first.tokens).filter(part => part.token).map(part => part.token?.id)).toEqual(["note", "second"]);
  const repeated = insertContextMentions(first.input, first.tokens, [note], { input: first.input, start: first.input.length, end: first.input.length });
  expect(repeated.tokens).toHaveLength(2);
  expect(repeated.tokens[0].mentions).toHaveLength(2);
  const prefixed = `请${repeated.input}`;
  const mapped = mapContextMentions(repeated.input, prefixed, repeated.tokens);
  expect(inlineContextParts(prefixed, mapped).filter(part => part.token)).toHaveLength(3);
  expect(mapContextMentions(first.input, "比较 普通文字", first.tokens)).toEqual([]);
});

test("a long reference inserts exactly its displayed short label, preserving the full identity", () => {
  const token = { ...note, label: "Not All Samples Are Created Equal: Understanding Research Evidence in Long Documents · §2.4" };
  const next = insertContextMentions("", [], [token], { input: "", start: 0, end: 0 });
  expect(next.input.length).toBeLessThan(token.label.length);
  expect(next.tokens[0].label).toBe(token.label);
  expect(next.tokens[0].contextRefs).toEqual(note.contextRefs);
  expect(next.input.trim()).toBe(next.tokens[0].mentions![0].text);
  expect(next.input).toContain("§2.4");
});

test("inserting a new revision with the same suggestion id cannot rebind earlier mentions", () => {
  const first = insertContextMentions("", [], [note], { input: "", start: 0, end: 0 });
  const newer = { ...note, contextRefs: [{ objectId: "note", revision: "v2" }] };
  const second = insertContextMentions(first.input, first.tokens, [newer], { input: first.input, start: first.input.length, end: first.input.length });
  expect(second.tokens).toHaveLength(2);
  expect(new Set(second.tokens.map(token => token.id)).size).toBe(2);
  expect(inlineContextParts(second.input, second.tokens).flatMap(part => part.token?.contextRefs ?? [])).toEqual([...note.contextRefs!, ...newer.contextRefs]);
  const alias = { ...newer, id: "other-suggestion", label: "新版别名" };
  const repeated = insertContextMentions(second.input, second.tokens, [alias], { input: second.input, start: second.input.length, end: second.input.length });
  expect(repeated.tokens).toHaveLength(2);
  expect(repeated.tokens.find(token => token.contextRefs?.[0] && "revision" in token.contextRefs[0] && token.contextRefs[0].revision === "v2")?.mentions).toHaveLength(2);
});

test("canonical reference sets ignore alias order but preserve selectors", () => {
  const firstToken = { ...note, contextRefs: [{ objectId: "note", revision: "v1", selectorId: "first" }, { objectId: "second", revision: "v1" }] };
  const first = insertContextMentions("", [], [firstToken], { input: "", start: 0, end: 0 });
  const again = insertContextMentions(first.input, first.tokens, [{ ...firstToken, id: "alias", contextRefs: [...firstToken.contextRefs].reverse() }], { input: first.input, start: first.input.length, end: first.input.length });
  expect(again.tokens).toHaveLength(1); expect(again.tokens[0].mentions).toHaveLength(2);
  const selected = { ...firstToken, contextRefs: [{ objectId: "note", revision: "v1", selectorId: "other" }] };
  const second = insertContextMentions(again.input, again.tokens, [selected], { input: again.input, start: again.input.length, end: again.input.length });
  expect(second.tokens).toHaveLength(2);
});


test.each([
  ["   CicN  ", "CicN", 3, 0],
  ["/  CicN  ", "/CicN", 3, 1],
  ["/  CicN  ", "CicN", 3, 0],
  ["  /  CicN  ", "/CicN", 5, 1],
  ["/CicN", "CicN", 1, 0],
  ["CicN", "/CicN", 0, 1],
])("adapts mention offsets through deterministic send normalization %s → %s", (previous, input, start, expected) => {
  const tokens = [{ ...note, mentions: [{ id: "mention", start, end: start + 4, text: "CicN" }] }];
  const adapted = adaptContextMentions(previous, input, tokens);
  expect(adapted[0]?.mentions).toEqual([{ id: "mention", start: expected, end: expected + 4, text: "CicN" }]);
  expect(inlineContextParts(input, adapted).filter(part => part.token)).toHaveLength(1);
});

test("inserting an equal display name before an old mention preserves their exact order and revisions", () => {
  const first = insertContextMentions("", [], [note], { input: "", start: 0, end: 0 });
  const second = insertContextMentions(first.input, first.tokens, [{ ...note, contextRefs: [{ objectId: "note", revision: "v2" }] }], { input: first.input, start: 0, end: 0 });
  expect(inlineContextParts(second.input, second.tokens).flatMap(part => part.token?.contextRefs ?? []))
    .toEqual([{ objectId: "note", revision: "v2" }, { objectId: "note", revision: "v1" }]);
});
