import type { AnswerPayload } from "../retrieval/retrieval.types";

export function formatAnswer(payload: AnswerPayload) {
  const citationText = payload.citations
    .map((citation) => `${citation.paperId} p.${citation.page}`)
    .join(", ");

  return `${payload.answer}\n引用: ${citationText}\n可信度: ${payload.confidence.toFixed(2)}`;
}
