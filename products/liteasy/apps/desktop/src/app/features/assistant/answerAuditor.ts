import type { Citation } from "../retrieval/retrieval.types";

export type AnswerAuditResult = {
  /** Legacy messages may contain an unverified model name. Never use it as execution proof. */
  model: string;
  rationale: string;
  /** Diagnostic value only; not a probability of semantic support. */
  score: number;
  verdict: "pass" | "review" | "fail";
  checkerKind?: "structural_rules" | "remote_service";
  status?: "completed" | "failed" | "timed_out";
  semanticStatus?: "unverified";
  reportedModel?: string;
  remoteAttempt?: {
    status: "completed" | "failed" | "timed_out";
    reason?: "http_error" | "invalid_response" | "network_error" | "timeout";
  };
};

type AuditAnswerInput = {
  answer: string;
  citations: Citation[];
  retrievalConfidence: number;
};

export function auditAssistantAnswer({
  answer,
  citations
}: AuditAnswerInput): AnswerAuditResult {
  const hasCitationText = citations.some((citation) => citation.snippet.trim().length > 0);
  const hasSubstantiveAnswer = answer.trim().length >= 12;

  return {
    model: "structural_rules",
    checkerKind: "structural_rules",
    status: "completed",
    semanticStatus: "unverified",
    rationale: hasCitationText && hasSubstantiveAnswer
      ? "已检查回答长度与引用片段是否存在；未核对原文定位或逐条语义支持。"
      : "回答或引用片段不足；尚未进行逐条语义核验。",
    score: (Number(hasCitationText) + Number(hasSubstantiveAnswer)) / 2,
    verdict: hasCitationText && hasSubstantiveAnswer ? "review" : "fail"
  };
}
