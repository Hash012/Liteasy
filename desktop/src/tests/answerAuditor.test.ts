import { auditAssistantAnswer } from "../app/features/assistant/answerAuditor";

test("marks answers without traceable citations for review", () => {
  expect(
    auditAssistantAnswer({
      answer: "结论不足。",
      citations: [],
      retrievalConfidence: 0.64
    })
  ).toEqual({
    model: "gpt-5-mini-auditor",
    rationale: "回答缺少足够的可追溯依据，需要人工复核。",
    score: 0.29,
    verdict: "fail"
  });
});
