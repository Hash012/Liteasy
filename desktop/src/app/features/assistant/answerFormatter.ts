import type { AnswerPayload } from "../retrieval/retrieval.types";

export type FormattedAnswer = {
  text: string;
  citations: Array<{ label: string; detail: string }>;
  confidence: number;
  verdict: "high" | "medium" | "low";
};

export function formatAnswer(payload: AnswerPayload): FormattedAnswer {
  const verdict: FormattedAnswer["verdict"] =
    payload.confidence >= 0.8 ? "high" : payload.confidence >= 0.5 ? "medium" : "low";

  const citations = payload.citations.map((c, i) => ({
    label: `[${i + 1}]`,
    detail: `p.${c.page} — ${c.snippet}`,
  }));

  const citationLines = citations.length > 0
    ? "\n\n" + citations.map((c) => `${c.label} ${c.detail}`).join("\n")
    : "";

  const text = `${payload.answer}${citationLines}\n\n可信度：${(payload.confidence * 100).toFixed(0)}%（${verdictLabel(verdict)}）`;

  return { text, citations, confidence: payload.confidence, verdict };
}

function verdictLabel(v: FormattedAnswer["verdict"]): string {
  switch (v) {
    case "high": return "高可信";
    case "medium": return "中可信";
    case "low": return "低可信";
  }
}
