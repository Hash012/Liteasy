import type { Paper } from "../workspace/workspace.types";
import type { RetrievalChunk } from "./retrieval.types";

export const demoKnowledgeBase: Record<string, RetrievalChunk[]> = {
  "demo-1": [
    {
      page: 2,
      paperId: "demo-1",
      paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
      snippet:
        "late interaction independently encodes query and document tokens before efficient retrieval",
      summary:
        "ColBERT 将查询和文档编码为上下文化 token 向量，并在检索阶段用 late interaction 保留细粒度匹配。",
      tags: ["核心方法", "方法", "ColBERT", "late interaction", "段落检索", "token matching"]
    },
    {
      page: 4,
      paperId: "demo-1",
      paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
      snippet: "MaxSim computes the maximum similarity between each query token and document tokens",
      summary: "MaxSim 让每个查询 token 在文档 token 中找到最佳匹配，在效率和准确率之间折中。",
      tags: ["MaxSim", "效率", "索引", "相关性", "BERT"]
    }
  ],
  "demo-2": [
    {
      page: 4,
      paperId: "demo-2",
      paperTitle: "Survey of Vector Database Management Systems",
      snippet:
        "vector database management systems manage unstructured data embeddings with indexes and query processing",
      summary:
        "向量数据库管理系统把非结构化对象映射为向量表示，并围绕存储、索引、查询处理和更新维护组织能力。",
      tags: ["核心方法", "方法", "向量数据库", "向量数据库管理系统", "索引", "查询处理", "vector database"]
    },
    {
      page: 6,
      paperId: "demo-2",
      paperTitle: "Survey of Vector Database Management Systems",
      snippet: "ANN indexes, query optimization, and hybrid filtering are core components",
      summary: "综述把向量索引、近似最近邻搜索、混合过滤和系统评测作为主要设计维度。",
      tags: ["向量索引", "ANN", "过滤查询", "系统评测", "hybrid filtering"]
    }
  ],
  "demo-3": [
    {
      page: 3,
      paperId: "demo-3",
      paperTitle: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
      snippet: "ACORN is a predicate-agnostic search algorithm for vector embeddings and structured data",
      summary: "ACORN 面向带结构化过滤条件的向量搜索，通过结构化过滤和向量近邻搜索协同提升性能。",
      tags: ["核心方法", "方法", "ACORN", "结构化过滤", "向量搜索", "predicate-agnostic"]
    },
    {
      page: 5,
      paperId: "demo-3",
      paperTitle: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
      snippet: "the approach avoids assumptions about predicate selectivity during search",
      summary: "predicate-agnostic 设计减少对过滤选择率的依赖，适合混合向量和结构化数据场景。",
      tags: ["predicate-agnostic", "过滤选择率", "structured data", "混合查询"]
    }
  ]
};

export function buildDemoChunksForPaper(paper: Paper): RetrievalChunk[] {
  const chunks = demoKnowledgeBase[paper.id];

  if (!chunks) {
    return [
      {
        page: 1,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet: "local PDF imported into Liteasy reader",
        summary: "Liteasy 已将该 PDF 导入本地阅读流程，后续可接入真实解析片段。",
        tags: ["本地导入", "PDF", "文献阅读"]
      }
    ];
  }

  return chunks.map((chunk) => ({
    ...chunk,
    paperId: paper.id,
    paperTitle: paper.title
  }));
}
