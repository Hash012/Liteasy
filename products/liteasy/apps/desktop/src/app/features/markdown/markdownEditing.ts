export type MarkdownSelection = { start: number; end: number };
export type MarkdownEdit = { value: string; selection: MarkdownSelection };
export type MarkdownCommand =
  | "bold" | "italic" | "strike" | "code" | "link" | "image"
  | "paragraph" | `heading-${1 | 2 | 3 | 4 | 5 | 6}`
  | "bullet" | "numbered" | "task" | "quote" | "indent" | "outdent"
  | "table" | "code-block" | "math" | "math-block" | "diagram" | "divider";

/** Operates on the existing selection; it never parses or renders the whole document. */
export function formatMarkdown(value: string, range: MarkdownSelection, command: MarkdownCommand): MarkdownEdit {
  const start = Math.max(0, Math.min(value.length, range.start));
  const end = Math.max(start, Math.min(value.length, range.end));
  const selected = value.slice(start, end);
  const replace = (from: number, to: number, content: string, selectFrom = 0, selectTo = content.length): MarkdownEdit => ({
    value: value.slice(0, from) + content + value.slice(to),
    selection: { start: from + selectFrom, end: from + selectTo },
  });
  const wrap = (marker: string, placeholder: string): MarkdownEdit => {
    if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      return replace(start, end, selected.slice(marker.length, -marker.length));
    }
    if (start >= marker.length && value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker) {
      return replace(start - marker.length, end + marker.length, selected);
    }
    const text = selected || placeholder;
    return replace(start, end, marker + text + marker, marker.length, marker.length + text.length);
  };
  switch (command) {
    case "bold": return wrap("**", "加粗文字");
    case "italic": return wrap("*", "斜体文字");
    case "strike": return wrap("~~", "删除线文字");
    case "code": {
      const runs = selected.match(/`+/g) ?? [];
      const marker = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
      const text = selected || "代码";
      const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return replace(start, end, marker + padding + text + padding + marker, marker.length + padding.length, marker.length + padding.length + text.length);
    }
    case "math": return wrap("$", "E = mc^2");
    case "link":
    case "image": {
      const prefix = `${command === "image" ? "!" : ""}[${selected || (command === "image" ? "图片说明" : "链接文字")}](`;
      return replace(start, end, `${prefix}https://)`, prefix.length, prefix.length + 8);
    }
  }
  const fence = "`".repeat(Math.max(2, ...(selected.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const blocks: Partial<Record<MarkdownCommand, { before: string; text: string; after: string }>> = {
    table: { before: "", text: "| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |", after: "" },
    "code-block": { before: `${fence}text\n`, text: selected || "代码", after: `\n${fence}` },
    "math-block": { before: "$$\n", text: selected || "E = mc^2", after: "\n$$" },
    diagram: { before: "```mermaid\n", text: "flowchart LR\n  A[开始] --> B[研究] --> C[结论]", after: "\n```" },
    divider: { before: "", text: "---", after: "" },
  };
  const block = blocks[command];
  if (block) {
    const before = (start > 0 ? (value.slice(0, start).endsWith("\n\n") ? "" : value[start - 1] === "\n" ? "\n" : "\n\n") : "") + block.before;
    const after = block.after + (end < value.length ? (value.slice(end).startsWith("\n\n") ? "" : value[end] === "\n" ? "\n" : "\n\n") : "\n");
    return replace(start, end, before + block.text + after, before.length, before.length + block.text.length);
  }
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  // A selection ending at the next line's start must not format that extra line.
  const lastSelected = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextNewline = value.indexOf("\n", lastSelected);
  const lineEnd = nextNewline < 0 ? value.length : nextNewline;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const prefix = command.startsWith("heading-") ? `${"#".repeat(Number(command.slice(-1)))} `
    : command === "bullet" ? "- " : command === "task" ? "- [ ] " : command === "quote" ? "> " : "";
  const alreadyApplied = prefix && lines.every((line) => line.startsWith(prefix));
  const result = lines.map((line, index) => {
    if (command === "indent") return `  ${line}`;
    if (command === "outdent") return line.replace(/^(?: {1,2}|\t)/, "");
    if (command === "paragraph" || command.startsWith("heading-")) return (command === "paragraph" || alreadyApplied ? "" : prefix) + line.replace(/^#{1,6} /, "");
    if (command === "quote") return alreadyApplied ? line.slice(2) : prefix + line;
    const content = line.replace(/^(?:[-+*] (?:\[[ xX]\] )?|\d+[.)] )/, "");
    if (command === "numbered") return `${index + 1}. ${content}`;
    return alreadyApplied ? content : prefix + content;
  }).join("\n");
  return replace(lineStart, lineEnd, result);
}
