import { describe, expect, test } from "vitest";
import { formatMarkdown } from "../app/features/markdown/markdownEditing";
import { MarkdownEditHistory } from "../app/features/markdown/markdownEditHistory";

describe("Markdown formatting", () => {
  test("formats the selection in place and toggles it without touching adjacent text", () => {
    const edit = formatMarkdown("往这里写入结论。", { start: 5, end: 7 }, "bold");
    expect(edit.value).toBe("往这里写入**结论**。");
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe("结论");
    expect(formatMarkdown(edit.value, edit.selection, "bold").value).toBe("往这里写入结论。");
  });
  test("selects the link destination for replacement and retains the selected label", () => {
    const edit = formatMarkdown("阅读 CicN", { start: 3, end: 7 }, "link");
    expect(edit.value).toBe("阅读 [CicN](https://)");
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe("https://");
  });
  test("changes complete selected lines and does not include the next unselected line", () => {
    const edit = formatMarkdown("one\ntwo\nthree", { start: 0, end: 8 }, "numbered");
    expect(edit.value).toBe("1. one\n2. two\nthree");
    expect(formatMarkdown(edit.value, edit.selection, "task").value).toBe("- [ ] one\n- [ ] two\nthree");
  });
  test("replaces headings instead of stacking prefixes, including an empty first line", () => {
    expect(formatMarkdown("### 原标题\n正文", { start: 5, end: 5 }, "heading-2").value).toBe("## 原标题\n正文");
    expect(formatMarkdown("## 原标题\n正文", { start: 5, end: 5 }, "paragraph").value).toBe("原标题\n正文");
    expect(formatMarkdown("\n正文", { start: 0, end: 0 }, "heading-1").value).toBe("# \n正文");
  });
  test("indents and outdents a multiline list without rewriting its content", () => {
    const original = "- 一\n- 二";
    const edit = formatMarkdown(original, { start: 0, end: original.length }, "indent");
    expect(edit.value).toBe("  - 一\n  - 二");
    expect(formatMarkdown(edit.value, edit.selection, "outdent").value).toBe(original);
  });
  test("isolates block formulas from surrounding paragraphs", () => {
    const edit = formatMarkdown("前文E=mc^2后文", { start: 2, end: 8 }, "math-block");
    expect(edit.value).toBe("前文\n\n$$\nE=mc^2\n$$\n\n后文");
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe("E=mc^2");
  });
  test("keeps literal backticks inside code spans and code blocks", () => {
    expect(formatMarkdown("a`b", { start: 0, end: 3 }, "code").value).toBe("``a`b``");
    expect(formatMarkdown("```js\ncode\n```", { start: 0, end: 14 }, "code-block").value).toBe("````text\n```js\ncode\n```\n````\n");
  });
});

describe("bounded Markdown edit history", () => {
  const range = (start: number, end = start) => ({ start, end });
  test("undoes typing and formatting together and discards redo after a new edit", () => {
    const history = new MarkdownEditHistory();
    history.record("", "h", range(0), range(1), true, 0);
    history.record("h", "hi", range(1), range(2), true, 100);
    history.record("hi", "**hi**", range(0, 2), range(2, 4));
    expect(history.undo("**hi**")).toEqual({ value: "hi", selection: range(0, 2) });
    expect(history.undo("hi")?.value).toBe("");
    expect(history.redo("")?.value).toBe("hi");
    history.record("hi", "hello", range(0, 2), range(5));
    expect(history.canRedo).toBe(false);
    expect(history.undo("hello")?.value).toBe("hi");
  });
  test("coalesces backspace and restores the original cursor", () => {
    const history = new MarkdownEditHistory();
    history.record("abc", "ab", range(3), range(2), true, 0);
    history.record("ab", "a", range(2), range(1), true, 100);
    expect(history.undo("a")).toEqual({ value: "abc", selection: range(3) });
  });
  test("stores small patches for large documents, with a character and entry limit", () => {
    const history = new MarkdownEditHistory(6, 2);
    const large = "x".repeat(100_000);
    history.record(large, large + "a", range(large.length), range(large.length + 1));
    expect(history.undo(large + "a")?.value).toBe(large);
    history.clear();
    history.record("", "a", range(0), range(1));
    history.record("a", "ab", range(1), range(2));
    history.record("ab", "abc", range(2), range(3));
    expect(history.undo("abc")?.value).toBe("ab");
    expect(history.undo("ab")?.value).toBe("a");
    expect(history.canUndo).toBe(false);
    history.record("a", "large paste", range(1), range(11));
    expect(history.canUndo).toBe(false);
  });
  test("cannot undo a patch over a different externally loaded document", () => {
    const history = new MarkdownEditHistory();
    history.record("before", "after", range(0), range(5));
    expect(history.undo("external")).toBeUndefined();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
