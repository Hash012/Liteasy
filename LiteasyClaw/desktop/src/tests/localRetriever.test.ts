import { retrieveAnswer } from "../app/features/retrieval/localRetriever";
import { buildImportedChunksForPaper } from "./fixtures/retrievalFixtures";

test("retrieves a vector-database-grounded answer for a core-method question", () => {
  const paper = {
    id: "demo-2",
    title: "Survey of Vector Database Management Systems"
  };
  const result = retrieveAnswer({
    importedChunksByPaperId: {
      [paper.id]: buildImportedChunksForPaper(paper)
    },
    question: "向量数据库管理系统的核心组件是什么？",
    selectedPapers: [paper]
  });

  expect(result.answer).toContain("向量数据库管理系统");
  expect(result.citations[0]?.paperId).toBe("demo-2");
  expect(result.citations[0]?.page).toBe(4);
  expect(result.citations[0]?.snippet).toContain("vector database management systems");
});

test("prefers imported parsed chunks over built-in fixture knowledge", () => {
  const result = retrieveAnswer({
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 10,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet: "custom imported chunk about filtered ANN query processing",
          summary: "导入结果显示这里重点讨论 filtered ANN query processing。",
          tags: ["filtered ANN", "过滤查询"]
        }
      ]
    },
    question: "filtered ANN 是什么？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ]
  });

  expect(result.answer).toContain("filtered ANN");
  expect(result.citations[0]?.page).toBe(10);
  expect(result.citations[0]?.snippet).toContain("custom imported chunk");
});
