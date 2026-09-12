/** Extract only the user-facing summary from a possibly incomplete JSON stream. */
export function extractThinReadingDraft(value: string): string {
  const text = value.replace(/^\s*```(?:json)?\s*/, "").trimStart();
  if (!text.startsWith("{")) return text.startsWith("[") ? "" : text;
  const match = text.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return "";
  try {
    const escaped = match[1].replace(/\\u[0-9a-f]{0,3}$/i, "").replace(/\\$/, "");
    return JSON.parse(`"${escaped}"`) as string;
  } catch { return ""; }
}
