import { retrieveAnswer } from "../app/features/retrieval/localRetriever";

test("retrieves a bert-grounded answer for a core-method question", () => {
  const result = retrieveAnswer({
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-2",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ]
  });

  expect(result.answer).toContain("双向预训练");
  expect(result.citations[0]?.paperId).toBe("demo-2");
  expect(result.citations[0]?.page).toBe(7);
  expect(result.citations[0]?.snippet).toContain("left and right context");
});

test("prefers imported parsed chunks over built-in fixture knowledge", () => {
  const result = retrieveAnswer({
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 10,
          paperId: "demo-2",
          paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          snippet: "custom imported chunk about token-level supervision",
          summary: "导入结果显示这里重点讨论 token-level supervision。",
          tags: ["token-level supervision", "监督信号"]
        }
      ]
    },
    question: "token-level supervision 是什么？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ]
  });

  expect(result.answer).toContain("token-level supervision");
  expect(result.citations[0]?.page).toBe(10);
  expect(result.citations[0]?.snippet).toContain("custom imported chunk");
});
