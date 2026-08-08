import type { RetrievalChunk } from "../../app/features/retrieval/retrieval.types";
import type { Paper } from "../../app/features/workspace/workspace.types";

const chunksByPaperId: Record<string, RetrievalChunk[]> = {
  "demo-1": [
    {
      page: 2,
      paperId: "demo-1",
      paperTitle: "ColBERT",
      snippet: "late interaction independently encodes query and document tokens before efficient retrieval",
      summary: "ColBERT 将查询和文档编码为上下文化 token 向量，并在检索阶段用 late interaction 保留细粒度匹配。",
      tags: ["核心方法", "ColBERT", "late interaction"]
    },
    {
      page: 4,
      paperId: "demo-1",
      paperTitle: "ColBERT",
      snippet: "MaxSim computes the maximum similarity between each query token and document tokens",
      summary: "MaxSim 让每个查询 token 在文档 token 中找到最佳匹配。",
      tags: ["MaxSim", "效率", "索引"]
    }
  ],
  "demo-2": [
    {
      page: 4,
      paperId: "demo-2",
      paperTitle: "Survey of Vector Database Management Systems",
      snippet: "vector database management systems manage unstructured data embeddings with indexes and query processing",
      summary: "向量数据库管理系统围绕存储、索引、查询处理和更新维护组织能力。",
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
  ],
  "demo-3": [
    {
      page: 3,
      paperId: "demo-3",
      paperTitle: "ACORN",
      snippet: "ACORN is a predicate-agnostic search algorithm for vector embeddings and structured data",
      summary: "ACORN 通过结构化过滤和向量近邻搜索协同提升性能。",
      tags: ["核心方法", "结构化过滤", "向量搜索"]
    },
    {
      page: 5,
      paperId: "demo-3",
      paperTitle: "ACORN",
      snippet: "the approach avoids assumptions about predicate selectivity during search",
      summary: "predicate-agnostic 设计减少对过滤选择率的依赖。",
      tags: ["predicate-agnostic", "过滤选择率"]
    }
  ]
};

export function buildImportedChunksForPaper(paper: Paper): RetrievalChunk[] {
  return (chunksByPaperId[paper.id] ?? [{
    page: 1,
    paperId: paper.id,
    paperTitle: paper.title,
    snippet: "test-only parsed PDF text",
    summary: "测试边界内注入的解析结果。",
    tags: ["test"]
  }]).map((chunk) => ({ ...chunk, paperId: paper.id, paperTitle: paper.title }));
}

export function importedChunksByPaperId(papers: Paper[]): Record<string, RetrievalChunk[]> {
  return Object.fromEntries(papers.map((paper) => [paper.id, buildImportedChunksForPaper(paper)]));
}
