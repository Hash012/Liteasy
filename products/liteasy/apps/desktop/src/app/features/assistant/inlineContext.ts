import { contextReferenceIdentity } from "./contextSelectionManifest";
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

/** Only explicit, still-valid ranges carry reference identity. Legacy names remain ordinary text. */
export function inlineContextParts(input: string, tokens: AssistantContextToken[]): ContextTextPart[] {
  const ranges = tokens.flatMap(token => (token.mentions ?? []).map(mention => ({ ...mention, token })))
    .filter(range => Number.isSafeInteger(range.start) && range.start >= 0 && range.end > range.start && input.slice(range.start, range.end) === range.text)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result: ContextTextPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) result.push({ text: input.slice(cursor, range.start) });
    result.push({ text: range.text, token: range.token });
    cursor = range.end;
  }
  if (cursor < input.length || !result.length) result.push({ text: input.slice(cursor) });
  return result;
}

export function shortContextName(token: Pick<AssistantContextToken, "label">) {
  const name = contextName(token);
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name), part => part.segment);
  if (graphemes.length <= 30) return name;
  const locator = name.match(/(?: · | — )(?:§|p\.|第 |Fig\.)[^·]{1,32}$/)?.[0] ?? "";
  return `${graphemes.slice(0, 24).join("")}…${locator}`;
}

/** Rebase ranges through one editor change; text edited inside a mention becomes plain text. */
export function mapContextMentions(previous: string, input: string, tokens: AssistantContextToken[]) {
  if (previous === input) return tokens;
  let start = 0;
  while (start < Math.min(previous.length, input.length) && previous[start] === input[start]) start++;
  let oldEnd = previous.length, newEnd = input.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === input[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return tokens.flatMap(token => {
    if (!token.mentions?.length) return [token];
    const mentions = token.mentions.flatMap(mention => {
      if (mention.end <= start) return [mention];
      if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
      return [];
    }).filter(mention => input.slice(mention.start, mention.end) === mention.text);
    return mentions.length ? [{ ...token, mentions }] : [];
  });
}

/** Canonical refs own identity; suggestion ids and labels only identify UI candidates. */
function tokenReferenceIdentity(token: AssistantContextToken) {
  if (token.contextRefs?.length) return JSON.stringify(["refs", [...new Set(token.contextRefs.map(contextReferenceIdentity))].sort()]);
  return JSON.stringify(["unresolved", token.kind, token.id, token.resourcePath ?? null, token.prompt]);
}

export function insertContextMentions(input: string, existing: AssistantContextToken[], tokens: AssistantContextToken[], insertion: ContextInsertion) {
  const { start, end } = rebaseInsertion(input, insertion);
  const display = tokens.map(token => ({ ...token, label: shortContextName(token) }));
  const next = insertContextNames(input, display, { input, start, end });
  const insertedLength = next.input.length - input.length + end - start;
  // The insertion owner knows the exact replaced range; equal neighboring labels must not
  // make a longest-common-prefix diff move the new identity onto an older mention.
  const mapped = existing.flatMap(token => {
    if (!token.mentions?.length) return [token];
    const mentions = token.mentions.flatMap(mention => mention.end <= start ? [mention] : mention.start >= end
      ? [{ ...mention, start: mention.start + insertedLength - (end - start), end: mention.end + insertedLength - (end - start) }] : [])
      .filter(mention => next.input.slice(mention.start, mention.end) === mention.text);
    return mentions.length ? [{ ...token, mentions }] : [];
  });
  let cursor = start + (input.slice(0, start) && !/[\s([（【《「]$/.test(input.slice(0, start)) ? 1 : 0);
  for (const token of tokens) {
    const text = shortContextName(token);
    if (!text) continue;
    const identity = tokenReferenceIdentity(token);
    const previous = mapped.find(value => tokenReferenceIdentity(value) === identity);
    const mention = { id: `mention-${crypto.randomUUID()}`, start: cursor, end: cursor + text.length, text };
    const id = previous?.id ?? (mapped.some(value => value.id === token.id) ? `${token.id}:context-${crypto.randomUUID()}` : token.id);
    const value = { ...(previous ?? token), id, mentions: [...(previous?.mentions ?? []), mention] };
    if (previous) mapped[mapped.indexOf(previous)] = value; else mapped.push(value);
    cursor += text.length + 1;
  }
  return { ...next, tokens: mapped, insertedRange: { start, end: start + insertedLength } };
}

/** Local shortcut routing must not treat an attached filename as a command. */
export function contextInstructionText(input: string, tokens: AssistantContextToken[]) {
  return inlineContextParts(input, tokens).map((part) => part.token ? "所附资料" : part.text).join("");
}


/** Only the deterministic send adapter uses this mapping; ordinary edits use mapContextMentions. */
export function adaptContextMentions(previous: string, input: string, tokens: AssistantContextToken[]) {
  if (previous === input) return tokens;
  const leading = previous.length - previous.trimStart().length;
  const trimmed = previous.trim();
  // Normalizing a command can remove whitespace both beside the slash and at the end.
  if (trimmed.startsWith("/")) {
    const command = trimmed.slice(1);
    const body = command.trim();
    if (input === body || input === `/${body}`) {
      const sourceStart = leading + 1 + command.length - command.trimStart().length;
      const targetStart = input === body ? 0 : 1;
      return projectMentionSubstring(previous, input, tokens, sourceStart, sourceStart + body.length, targetStart);
    }
  }
  if (input === trimmed) return projectMentionSubstring(previous, input, tokens, leading, leading + trimmed.length, 0);
  // Explicit adapter projections may retain a single exact substring; ambiguous text is never guessed.
  const start = input ? previous.indexOf(input) : -1;
  if (start >= 0 && previous.indexOf(input, start + 1) < 0) return projectMentionSubstring(previous, input, tokens, start, start + input.length, 0);
  return mapContextMentions(previous, input, tokens);
}

function projectMentionSubstring(previous: string, input: string, tokens: AssistantContextToken[], sourceStart: number, sourceEnd: number, targetStart: number) {
  return tokens.flatMap(token => {
    if (!token.mentions?.length) return [token];
    const mentions = token.mentions.filter(mention => mention.start >= sourceStart && mention.end <= sourceEnd &&
      previous.slice(mention.start, mention.end) === mention.text)
      .map(mention => ({ ...mention, start: mention.start - sourceStart + targetStart, end: mention.end - sourceStart + targetStart }))
      .filter(mention => input.slice(mention.start, mention.end) === mention.text);
    return mentions.length ? [{ ...token, mentions }] : [];
  });
}
