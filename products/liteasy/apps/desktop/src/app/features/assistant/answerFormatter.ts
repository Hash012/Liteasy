import type { AnswerPayload } from "../retrieval/retrieval.types";

export function formatAnswer(payload: AnswerPayload) {
  return payload.answer;
}

/** Remove the legacy machine-generated footer when reopening older conversations. */
export function getAnswerDisplayText(content: string) {
  return content.replace(/\n引用[:：][^\n]*\n(?:可信度|置信度)[:：]\s*\d+(?:\.\d+)?\s*$/u, "");
}
