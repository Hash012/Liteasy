/** Preserve ordinary hyphens: removing them can change a scientific term. */
export function normalizeLookupText(text: string) {
  return text.replace(/\u00ad\s*/g, "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function isDictionarySelection(text: string) {
  const words = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
  return text.length <= 100 && words.length > 0 && words.length <= 6 && !/[.!?。！？;；\n]/.test(text);
}

/** Only send a short surrounding passage; lookup never depends on PDF geometry. */
export function selectionLookupContext(pageText: string, excerpt: string, offset?: number) {
  const text = normalizeLookupText(pageText);
  const needle = normalizeLookupText(excerpt);
  const start = offset !== undefined && text.slice(offset, offset + needle.length) === needle
    ? offset : text.indexOf(needle);
  if (start < 0 || !needle) return "";
  const left = text.slice(Math.max(0, start - 250), start);
  const right = text.slice(start + needle.length, start + needle.length + 250);
  const boundary = Math.max(left.lastIndexOf(". "), left.lastIndexOf("! "), left.lastIndexOf("? "), left.lastIndexOf("。"));
  const end = right.search(/[.!?。！？](?:\s|$)/);
  return `${left.slice(boundary < 0 ? 0 : boundary + (left[boundary] === "。" ? 1 : 2))}${needle}${right.slice(0, end < 0 ? right.length : end + 1)}`.trim().slice(0, 600);
}

export function lookupResultNote(result: import("./selectionLookup.types").SelectionLookupResult) {
  return [result.translation, ...result.senses.map((sense) => `${sense.partOfSpeech ? `${sense.partOfSpeech} ` : ""}${sense.definition}${sense.example ? `\n例句：${sense.example}` : ""}`), `来源：${result.sourceLabel}`].filter(Boolean).join("\n");
}
