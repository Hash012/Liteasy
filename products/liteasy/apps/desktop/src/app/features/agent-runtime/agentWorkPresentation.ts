const internalReferencePattern = /\b(?:artifact-task|chunk|evidence|node|paper|run|source|subtask)[_:.\/-][a-z0-9][a-z0-9_.:/-]*\b/gi;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const localPathPattern = /(?:[A-Za-z]:\\|\/(?:home|Users|tmp|var)\/)[^\s)`]+/g;

function isStructuredPayload(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^[{[]/.test(normalized)) return true;
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  return lines.length > 2 && lines.every((line) => /^(?:[{}\[\],]|\s*"[^"\n]+"\s*:)/.test(line));
}

/** Converts streamed public model output into reader-facing Markdown. */
export function toUserVisibleAgentWorkMarkdown(value: string) {
  const redacted = value
    .replace(/```(?:json|jsonc)\s*[\s\S]*?```/gi, "")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[已隐藏的密钥]")
    .replace(/\b(api[_-]?key|authorization|bearer|secret|password)\s*[:=]\s*([^\s,;]+)/gi, "$1: [已隐藏]")
    .replace(internalReferencePattern, "〔内部引用〕")
    .replace(uuidPattern, "〔内部引用〕")
    .replace(localPathPattern, "〔本地路径已隐藏〕")
    .replace(/SubAgent/gi, "并行分析")
    .replace(/<\/?(?:system|developer|assistant|tool|quality_gate_reason|user-supplement)[^>]*>/gi, "")
    .trim();
  if (isStructuredPayload(redacted)) return "";
  return redacted.length > 8_000 ? `…${redacted.slice(-8_000)}` : redacted;
}
