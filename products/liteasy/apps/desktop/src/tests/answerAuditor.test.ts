import { auditAssistantAnswer } from "../app/features/assistant/answerAuditor";

test("marks answers without traceable citations for review", () => {
  expect(
    auditAssistantAnswer({
      answer: "结论不足。",
      citations: [],
      retrievalConfidence: 0.64
    })
  ).toEqual({
    model: "structural_rules",
    checkerKind: "structural_rules",
    status: "completed",
    semanticStatus: "unverified",
    rationale: "回答或引用片段不足；尚未进行逐条语义核验。",
    score: 0,
    verdict: "fail"
  });
});
