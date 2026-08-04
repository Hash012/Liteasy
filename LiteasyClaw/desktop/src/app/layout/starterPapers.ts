import type { Paper } from "../features/workspace/workspace.types";

export const starterPapers: Paper[] = [
  {
    id: "demo-1",
    forumTopicId: "rag-reliability",
    forumWorkId: "colbert-demo",
    title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
    sourcePath: "/papers/colbert-late-interaction.pdf"
  },
  {
    id: "demo-2",
    title: "Survey of Vector Database Management Systems",
    sourcePath: "/papers/survey-vector-database-management-systems.pdf"
  },
  {
    id: "demo-3",
    title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
    sourcePath: "/papers/acorn-vector-search.pdf"
  }
];
