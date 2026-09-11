import { formatAnswer } from "../app/features/assistant/answerFormatter";

test("keeps machine citation metadata out of answer text", () => {
  const result = formatAnswer({
    answer: "Transformer models rely on self-attention.",
    citations: [{ paperId: "p1", page: 3, snippet: "self-attention replaces recurrence" }],
    confidence: 0.84
  });

  expect(result).toBe("Transformer models rely on self-attention.");
});
