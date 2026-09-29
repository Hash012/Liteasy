import type { AssistantContextToken } from "./assistant.types";

/** A snapshot keeps async resource resolution anchored to the user's insertion point. */
export type ContextInsertion = { input: string; start: number; end: number };

export function contextName(token: Pick<AssistantContextToken, "label">) {
  return token.label.replace(/^[@/$]/, "").replace(/[\r\n]+/g, " ").trim();
}

function rebaseInsertion(current: string, insertion: ContextInsertion) {
  const previous = insertion.input;
  let start = Math.max(0, Math.min(insertion.start, previous.length));
  let end = Math.max(start, Math.min(insertion.end, previous.length));
  if (current === previous) return { start, end };
  let prefix = 0;
  while (prefix < Math.min(previous.length, current.length) && previous[prefix] === current[prefix]) prefix++;
  let oldEnd = previous.length;
  let newEnd = current.length;
  while (oldEnd > prefix && newEnd > prefix && previous[oldEnd - 1] === current[newEnd - 1]) { oldEnd--; newEnd--; }
  if (end <= prefix) return { start, end };
  if (start >= oldEnd) {
    start += newEnd - oldEnd;
    end += newEnd - oldEnd;
    return { start, end };
  }
  const selected = previous.slice(start, end);
  const relocated = selected ? current.indexOf(selected) : -1;
  // A mention can remain intact even if the user edits both sides while it loads.
  if (relocated >= 0 && current.indexOf(selected, relocated + 1) < 0 &&
    current[relocated - 1] === previous[start - 1] && current[relocated + selected.length] === previous[end]) {
    return { start: relocated, end: relocated + selected.length };
  }
  // If the user replaced the trigger while it was loading, keep their new text.
  return { start: newEnd, end: newEnd };
}

export function insertContextNames(input: string, tokens: AssistantContextToken[], insertion: ContextInsertion) {
  const { start, end } = rebaseInsertion(input, insertion);
  const names = tokens.map(contextName).filter(Boolean).join(" ");
  if (!names) return { input, caret: start };
  const before = input.slice(0, start);
  const after = input.slice(end);
  const leading = before && !/[\s([（【《「]$/.test(before) ? " " : "";
  const trailing = !after || !/^[\s,，。.!！?？;；:：)\]）】》」]/.test(after) ? " " : "";
  const inserted = `${leading}${names}${trailing}`;
  return { input: before + inserted + after, caret: before.length + inserted.length };
}

export type ContextTextPart = { text: string; token?: AssistantContextToken };

/** Highlight only names of attached resources; never change the model's plain text. */
export function inlineContextParts(input: string, tokens: AssistantContextToken[]): ContextTextPart[] {
  const names = [...new Map(tokens.map((token) => [contextName(token), token])).entries()]
    .filter(([name]) => name).sort((a, b) => b[0].length - a[0].length);
  if (!names.length) return [{ text: input }];
  const result: ContextTextPart[] = [];
  let plainStart = 0;
  for (let offset = 0; offset < input.length;) {
    const matched = names.find(([name]) => input.startsWith(name, offset) &&
      !(/[\w]/.test(name[0]) && /[\w]/.test(input[offset - 1] ?? "")) &&
      !(/[\w]/.test(name.at(-1)!) && /[\w]/.test(input[offset + name.length] ?? "")));
    if (!matched) { offset++; continue; }
    if (offset > plainStart) result.push({ text: input.slice(plainStart, offset) });
    result.push({ text: matched[0], token: matched[1] });
    offset += matched[0].length;
    plainStart = offset;
  }
  if (plainStart < input.length) result.push({ text: input.slice(plainStart) });
  return result;
}

/** Local shortcut routing must not treat an attached filename as a command. */
export function contextInstructionText(input: string, tokens: AssistantContextToken[]) {
  return inlineContextParts(input, tokens).map((part) => part.token ? "所附资料" : part.text).join("");
}
