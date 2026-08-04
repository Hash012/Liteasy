import type { ThinReadingExternalSource } from "../thin-reading/thinReading.types";

export function associationRelationLabel(relation: ThinReadingExternalSource["relation"]) {
  if (relation === "cited_by_target") return "本文直接引用";
  if (relation === "cites_target") return "后续论文引用本文";
  if (relation === "co_cited") return "共同被引";
  if (relation === "bibliographic_coupling") return "共享局部参考文献";
  if (relation === "related") return "引用图相关工作";
  return "语义检索";
}

export function associationConfidenceLabel(
  basis: ThinReadingExternalSource["confidenceBasis"]
) {
  if (basis === "author_citation") return "作者亲引";
  if (basis === "canonical_registry") return "权威词表精确匹配";
  if (basis === "citation_graph") return "引用图推导";
  return "语义相似，无引用关系";
}

export function associationSourceReason(source: ThinReadingExternalSource) {
  const relation = associationRelationLabel(source.relation);
  if (source.confidenceBasis === "canonical_registry") {
    return `已知数据集或指标的提出论文：${source.retrievalQuery.replace(/^权威词表：/u, "")}`;
  }
  if (source.confidenceBasis !== "algorithmic_retrieval") return relation;
  const query = source.retrievalQueries?.[0] ?? source.retrievalQuery;
  return query ? `${relation}：“${query}”` : relation;
}

export function associationSourceMetadata(source: ThinReadingExternalSource) {
  return [source.authors.join(", "), source.year].filter(Boolean).join(" · ");
}
