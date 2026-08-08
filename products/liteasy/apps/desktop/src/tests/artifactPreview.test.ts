import { buildArtifactPreview } from "../app/features/artifacts/artifactPreview";

test("builds a mindmap-friendly preview from imported chunks", () => {
  const preview = buildArtifactPreview(
    [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    {
      "demo-2": [
        {
          page: 4,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet:
            "vector database management systems manage unstructured data embeddings with indexes and query processing",
          summary: "向量数据库管理系统围绕向量表示、索引和查询处理组织能力。",
          tags: ["核心方法", "向量数据库管理系统", "索引"]
        },
        {
          page: 6,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet: "ANN indexes, query optimization, and hybrid filtering are core components",
          summary: "综述把向量索引、近似最近邻搜索和混合过滤作为主要设计维度。",
          tags: ["向量索引", "ANN", "过滤查询"]
        }
      ]
    }
  );

  expect(preview?.rootLabel).toBe("Survey of Vector Database Management Systems");
  expect(preview?.nodes).toContain("向量数据库管理系统");
  expect(preview?.nodes).toContain("向量索引");
});
