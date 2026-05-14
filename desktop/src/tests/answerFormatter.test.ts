import { formatAnswer } from "../app/features/assistant/answerFormatter";

test("formats answer text with citation references and confidence", () => {
  const result = formatAnswer({
    answer: "Transformer models rely on self-attention.",
    citations: [{ paperId: "p1", page: 3, snippet: "self-attention replaces recurrence" }],
    confidence: 0.84,
  });

  expect(result.text).toContain("p.3");
  expect(result.text).toContain("84%");
  expect(result.verdict).toBe("high");
  expect(result.citations).toHaveLength(1);
});

test("marks low confidence as low verdict", () => {
  const result = formatAnswer({
    answer: "This is uncertain.",
    citations: [],
    confidence: 0.3,
  });

  expect(result.verdict).toBe("low");
});

test("formats multiple citations", () => {
  const result = formatAnswer({
    answer: "Multiple sources.",
    citations: [
      { paperId: "a", page: 1, snippet: "source A" },
      { paperId: "b", page: 5, snippet: "source B" },
    ],
    confidence: 0.9,
  });

  expect(result.citations).toHaveLength(2);
  expect(result.text).toContain("[1]");
  expect(result.text).toContain("[2]");
});
