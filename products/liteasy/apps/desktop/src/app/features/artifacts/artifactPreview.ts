import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";
import type { ArtifactPreview } from "./artifact.types";

function getRepresentativeNode(chunk: RetrievalChunk) {
  if (chunk.tags.includes("向量数据库管理系统")) {
    return "向量数据库管理系统";
  }

  if (chunk.tags.includes("向量索引")) {
    return "向量索引";
  }

  if (chunk.tags.includes("结构化过滤")) {
    return "结构化过滤";
  }

  if (chunk.tags.includes("predicate-agnostic")) {
    return "Predicate-agnostic Search";
  }

  if (chunk.tags.includes("late interaction")) {
    return "Late Interaction";
  }

  if (chunk.tags.includes("MaxSim")) {
    return "MaxSim";
  }

  if (chunk.tags.includes("预训练目标")) {
    return "预训练目标";
  }

  if (chunk.tags.includes("双向预训练")) {
    return "双向预训练";
  }

  if (chunk.tags.includes("多头注意力")) {
    return "多头注意力";
  }

  if (chunk.tags.includes("自注意力")) {
    return "自注意力";
  }

  return chunk.tags.find((tag) => /[\u4e00-\u9fff]/.test(tag) && tag.length >= 3) ?? chunk.summary;
}

export function buildArtifactPreview(
  selectedPapers: Paper[],
  importedChunksByPaperId: Record<string, RetrievalChunk[]>
): ArtifactPreview | undefined {
  const primaryPaper = selectedPapers[0];
  if (!primaryPaper) {
    return undefined;
  }

  const chunks = importedChunksByPaperId[primaryPaper.id] ?? [];
  const nodes = Array.from(
    new Set(chunks.map((chunk) => getRepresentativeNode(chunk)).filter(Boolean))
  ).slice(0, 4);

  return {
    nodes: nodes.length ? nodes : ["核心方法", "系统结构", "研究结论"],
    rootLabel: primaryPaper.title
  };
}
