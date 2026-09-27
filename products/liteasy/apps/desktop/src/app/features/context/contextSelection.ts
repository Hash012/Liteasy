export type ContextRange = { start: number; end: number };
export type ContextCoverage = {
  status: "full" | "partial" | "omitted";
  totalCharacters: number;
  includedCharacters: number;
  /** Offsets refer to UTF-16 characters in the fixed source revision. */
  ranges: ContextRange[];
  omittedRanges: ContextRange[];
  strategy: "complete" | "question" | "balanced";
};

export function contextTokens(text: string) {
  return Math.ceil(new TextEncoder().encode(text).length / 3);
}

/** Small resources get their full allocation; remaining capacity is shared equally. */
export function allocateContextBudgets(costs: number[], budget: number): number[] {
  const allocations = costs.map(() => 0);
  let remaining = Math.max(0, Math.floor(budget));
  const sorted = costs.map((cost, index) => ({ cost, index })).sort((a, b) => a.cost - b.cost);
  sorted.forEach(({ cost, index }, position) => {
    allocations[index] = Math.min(cost, Math.floor(remaining / (sorted.length - position)));
    remaining -= allocations[index];
  });
  return allocations;
}

function safeEnd(text: string, end: number) {
  return end < text.length && /[\uDC00-\uDFFF]/.test(text[end]) ? end - 1 : end;
}

function fitPrefix(text: string, budget: number) {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (contextTokens(text.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return safeEnd(text, low);
}

function searchTerms(question: string) {
  const words = question.toLocaleLowerCase().match(/[a-z0-9_-]{3,}|[\p{Script=Han}]{2,}/gu) ?? [];
  return [...new Set(words.flatMap((word) => /\p{Script=Han}/u.test(word)
    ? [word, ...Array.from({ length: Math.min(word.length - 1, 40) }, (_, index) => word.slice(index, index + 2))]
    : [word]))].slice(0, 80);
}

export function selectContextText(text: string, budget: number, question = ""): { text: string; coverage: ContextCoverage } {
  const full = contextTokens(text) <= budget;
  const terms = searchTerms(question);
  let ranges: ContextRange[] = [];
  if (full) ranges = text.length ? [{ start: 0, end: text.length }] : [];
  else if (budget > 0) {
    const chunks: Array<ContextRange & { score: number }> = [];
    for (let start = 0; start < text.length;) {
      let end = safeEnd(text, Math.min(text.length, start + 1200));
      const paragraph = start + text.slice(start, end).lastIndexOf("\n");
      if (paragraph > start + 400) end = paragraph + 1;
      const body = text.slice(start, end).toLocaleLowerCase();
      chunks.push({ start, end, score: terms.reduce((score, term) => score + (body.includes(term) ? 1 : 0), 0) });
      start = end;
    }
    // Relevance wins, then spread selections through the resource instead of always taking its start.
    const order = chunks.map((chunk, index) => ({ ...chunk, priority: index === 0 ? 0 : index === chunks.length - 1 ? 1 : 2 + Math.abs(index - chunks.length / 2) }));
    order.sort((a, b) => b.score - a.score || a.priority - b.priority);
    let remaining = budget;
    for (const chunk of order) {
      const separatorCost = ranges.length ? contextTokens("\n\n[…]\n\n") : 0;
      let start = chunk.start;
      if (chunk.score && contextTokens(text.slice(start, chunk.end)) > remaining - separatorCost) {
        const body = text.slice(start, chunk.end).toLocaleLowerCase();
        const firstMatch = Math.min(...terms.map((term) => body.indexOf(term)).filter((index) => index >= 0));
        // Preserve some leading context while making sure a small fair allocation reaches the matching passage.
        start += Math.max(0, firstMatch - Math.min(80, Math.floor((remaining - separatorCost) / 4)));
        if (/[\uDC00-\uDFFF]/.test(text[start])) start -= 1;
      }
      const length = fitPrefix(text.slice(start, chunk.end), remaining - separatorCost);
      if (!length) continue;
      const range = { start, end: start + length };
      ranges.push(range);
      remaining -= contextTokens(text.slice(range.start, range.end)) + separatorCost;
      if (remaining <= 0) break;
    }
    ranges.sort((a, b) => a.start - b.start);
  }
  const omittedRanges: ContextRange[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) omittedRanges.push({ start: cursor, end: range.start });
    cursor = range.end;
  }
  if (cursor < text.length) omittedRanges.push({ start: cursor, end: text.length });
  const includedCharacters = ranges.reduce((total, range) => total + range.end - range.start, 0);
  return {
    text: ranges.map((range) => text.slice(range.start, range.end)).join("\n\n[…]\n\n"),
    coverage: { status: full ? "full" : includedCharacters ? "partial" : "omitted", totalCharacters: text.length,
      includedCharacters, ranges, omittedRanges, strategy: full ? "complete" : terms.length ? "question" : "balanced" },
  };
}

export function contextCoveragePrompt(coverage?: ContextCoverage) {
  if (!coverage || coverage.status === "full") return "";
  const omitted = coverage.omittedRanges.slice(0, 8).map((range) => `${range.start + 1}–${range.end}`).join("、");
  return `\n读取范围：本轮仅提供 ${coverage.includedCharacters}/${coverage.totalCharacters} 个字符，未覆盖字符 ${omitted}${coverage.omittedRanges.length > 8 ? "等" : ""}。这不是全文；未覆盖部分不可据此判断，请按章节、页码或更具体的问题继续添加。`;
}
