import { formatAnswer } from "../app/features/assistant/answerFormatter";

test("formats answer text with citation references", () => {
  const result = formatAnswer({
    answer: "Transformer models rely on self-attention.",
    citations: [{ paperId: "p1", page: 3, snippet: "self-attention replaces recurrence" }],
    confidence: 0.84
  });

  expect(result).toContain("p.3");
  expect(result).toContain("0.84");
});
