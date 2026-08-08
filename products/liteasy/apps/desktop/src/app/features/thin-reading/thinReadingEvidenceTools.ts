import type { AnalysisEvidence, PreparedMultiPaperAnalysis } from "../paper-analysis/analysis.types";

export type ThinReadingEvidenceToolCall =
  | { evidenceIds: readonly string[]; kind: "read" }
  | { evidenceIds: readonly string[]; kind: "search"; query: string }
  | { evidenceIds: readonly string[]; kind: "view"; pages: readonly number[] };

export type ThinReadingEvidenceToolPlan = {
  pageRequests?: readonly number[];
  searchQueries?: readonly string[];
  selectedEvidenceIds: readonly string[];
};

export type ThinReadingEvidenceToolResult = {
  evidence: readonly AnalysisEvidence[];
  toolCalls: readonly ThinReadingEvidenceToolCall[];
};

const maximumEvidencePerToolResult = 6;
const maximumSelectedEvidence = 12;

function tokenize(value: string) {
  const latin = value.toLowerCase().match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  const chineseRuns = value.match(/[\u3400-\u9fff]+/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => run.length < 2
    ? [run]
    : Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  );
  return [...new Set([...latin, ...chinese])];
}

function scoreEvidence(queryTokens: readonly string[], evidence: AnalysisEvidence) {
  const text = `${evidence.paperTitle}\n${evidence.terms.join(" ")}\n${evidence.summary}\n${evidence.quote}`.toLowerCase();
  return queryTokens.reduce((score, token) => score + (text.includes(token.toLowerCase()) ? 1 : 0), 0);
}

function uniqueEvidence(ids: readonly string[], byId: ReadonlyMap<string, AnalysisEvidence>) {
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    if (seen.has(id) || !byId.has(id)) {
      return [];
    }
    seen.add(id);
    return [byId.get(id)!];
  });
}

/**
 * Bounded, deterministic evidence tools for a single prepared paper-analysis run.
 * They deliberately expose IDs and excerpts only from the current evidence allowlist.
 */
export function executeThinReadingEvidenceToolPlan(input: {
  plan: ThinReadingEvidenceToolPlan;
  prepared: PreparedMultiPaperAnalysis;
}): ThinReadingEvidenceToolResult {
  const byId = new Map(input.prepared.evidence.map((evidence) => [evidence.id, evidence]));
  const toolCalls: ThinReadingEvidenceToolCall[] = [];
  const selected = uniqueEvidence(input.plan.selectedEvidenceIds.slice(0, maximumSelectedEvidence), byId);
  if (selected.length > 0) {
    toolCalls.push({ evidenceIds: selected.map((evidence) => evidence.id), kind: "read" });
  }

  const collected = new Map(selected.map((evidence) => [evidence.id, evidence]));
  for (const rawQuery of input.plan.searchQueries?.slice(0, 3) ?? []) {
    const query = rawQuery.trim();
    if (!query) continue;
    const queryTokens = tokenize(query);
    const matches = input.prepared.evidence
      .map((evidence) => ({ evidence, score: scoreEvidence(queryTokens, evidence) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.evidence.page - right.evidence.page)
      .slice(0, maximumEvidencePerToolResult)
      .map((item) => item.evidence);
    toolCalls.push({ evidenceIds: matches.map((evidence) => evidence.id), kind: "search", query });
    matches.forEach((evidence) => {
      if (collected.size < maximumSelectedEvidence) collected.set(evidence.id, evidence);
    });
  }

  const pages = [...new Set((input.plan.pageRequests ?? []).filter((page) => Number.isInteger(page) && page > 0))]
    .slice(0, 3);
  if (pages.length > 0) {
    const matches = input.prepared.evidence
      .filter((evidence) => pages.includes(evidence.page))
      .slice(0, maximumEvidencePerToolResult);
    toolCalls.push({ evidenceIds: matches.map((evidence) => evidence.id), kind: "view", pages });
    matches.forEach((evidence) => {
      if (collected.size < maximumSelectedEvidence) collected.set(evidence.id, evidence);
    });
  }

  return {
    evidence: [...collected.values()],
    toolCalls
  };
}
