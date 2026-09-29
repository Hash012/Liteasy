import { describe, expect, test } from "vitest";
import { inlineContextParts, insertContextNames } from "../app/features/assistant/inlineContext";
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

  test("highlights the longest attached name and leaves ordinary words intact", () => {
    const parts = inlineContextParts("往CicN里面写入，不是CicNote；CicN 2026", [note, { ...note, id: "long", label: "CicN 2026" }]);
    expect(parts.filter((part) => part.token).map((part) => [part.text, part.token?.id]))
      .toEqual([["CicN", "note"], ["CicN 2026", "long"]]);
    expect(parts.map((part) => part.text).join("")).toBe("往CicN里面写入，不是CicNote；CicN 2026");
    expect(inlineContextParts("CicN", [])).toEqual([{ text: "CicN" }]);
  });
});
