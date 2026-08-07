import { buildImportedChunksForPaper } from "./fixtures/retrievalFixtures";

test("builds vector database survey fixture chunks for an imported paper", () => {
  const chunks = buildImportedChunksForPaper({
    id: "demo-2",
    title: "Survey of Vector Database Management Systems"
  });

  expect(chunks).toHaveLength(2);
  expect(chunks[0]?.paperId).toBe("demo-2");
  expect(chunks[0]?.summary).toContain("向量数据库管理系统");
  expect(chunks[1]?.tags).toContain("向量索引");
});

test("builds ACORN fixture chunks for an imported paper", () => {
  const chunks = buildImportedChunksForPaper({
    id: "demo-3",
    title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
  });

  expect(chunks).toHaveLength(2);
  expect(chunks[0]?.paperId).toBe("demo-3");
  expect(chunks[0]?.summary).toContain("结构化过滤");
  expect(chunks[1]?.tags).toContain("predicate-agnostic");
});
