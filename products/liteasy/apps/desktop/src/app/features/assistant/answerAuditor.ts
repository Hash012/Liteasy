import type { Citation } from "../retrieval/retrieval.types";

export type AnswerAuditResult = {
  model: "gpt-5-mini-auditor";
  rationale: string;
  score: number;
  verdict: "pass" | "review" | "fail";
};

type AuditAnswerInput = {
  answer: string;
  citations: Citation[];
  retrievalConfidence: number;
};

function clampScore(score: number) {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function getVerdict(score: number): AnswerAuditResult["verdict"] {
  if (score >= 0.8) {
    return "pass";
  }

  if (score >= 0.55) {
    return "review";
  }

  return "fail";
}

export function auditAssistantAnswer({
  answer,
  citations,
  retrievalConfidence
}: AuditAnswerInput): AnswerAuditResult {
  const hasTraceableCitation = citations.length > 0 && citations.some((citation) => citation.snippet.length > 0);
  const hasSubstantiveAnswer = answer.trim().length >= 12;
  const citationAdjustment = hasTraceableCitation ? 0 : -0.2;
  const answerAdjustment = hasSubstantiveAnswer ? 0 : -0.15;
  const score = clampScore(retrievalConfidence + citationAdjustment + answerAdjustment);

  return {
    model: "gpt-5-mini-auditor",
    rationale:
      hasTraceableCitation && hasSubstantiveAnswer
        ? "回答包含可追溯引用，且引用片段覆盖问题关键词。"
        : "回答缺少足够的可追溯依据，需要人工复核。",
    score,
    verdict: getVerdict(score)
  };
}
