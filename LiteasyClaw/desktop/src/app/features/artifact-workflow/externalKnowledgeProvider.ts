import type { MindmapExternalReferenceSource } from "./mindmapArtifact.types";

export type ExternalKnowledgeLookupInput = {
  question: string;
  terms: string[];
  timeoutMs: number;
};

export type ExternalKnowledgeProvider = {
  lookup: (input: ExternalKnowledgeLookupInput) => Promise<MindmapExternalReferenceSource[]>;
};

const deterministicReferences: Record<string, MindmapExternalReferenceSource> = {
  acorn: {
    authorityLevel: "high",
    reason: "method_lineage",
    refId: "external:acorn",
    sourceTitle: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
    summary: "ACORN proposes predicate-aware vector search techniques for filtered ANN retrieval."
  },
  "filtered ann": {
    authorityLevel: "high",
    reason: "concept_definition",
    refId: "external:filtered-ann",
    sourceTitle: "Filtered Approximate Nearest Neighbor Search",
    summary: "Filtered ANN combines vector similarity search with structured predicates or metadata filters."
  },
  "late interaction": {
    authorityLevel: "high",
    reason: "concept_definition",
    refId: "external:late-interaction",
    sourceTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
    summary: "Late interaction preserves token-level matching signals before aggregation."
  },
  maxsim: {
    authorityLevel: "high",
    reason: "concept_definition",
    refId: "external:late-interaction",
    sourceTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
    summary: "MaxSim aggregates the strongest token-level similarity signals in ColBERT-style late interaction."
  },
  "self-attention": {
    authorityLevel: "high",
    reason: "concept_definition",
    refId: "external:transformer",
    sourceTitle: "Attention Is All You Need",
    summary: "Self-attention relates sequence positions by computing attention over token representations."
  },
  transformer: {
    authorityLevel: "high",
    reason: "concept_definition",
    refId: "external:transformer",
    sourceTitle: "Attention Is All You Need",
    summary: "The Transformer architecture uses attention mechanisms for sequence modeling."
  },
  "vector database": {
    authorityLevel: "high",
    reason: "background",
    refId: "external:vector-database",
    sourceTitle: "Survey of Vector Database Management Systems",
    summary: "Vector database systems organize embedding storage, indexing, and similarity query processing."
  }
};

export function createDeterministicExternalKnowledgeProvider(): ExternalKnowledgeProvider {
  return {
    async lookup(input) {
      const matches = input.terms
        .map((term) => deterministicReferences[normalizeTerm(term)])
        .filter((reference): reference is MindmapExternalReferenceSource => Boolean(reference));

      return Array.from(new Map(matches.map((reference) => [reference.refId, reference])).values());
    }
  };
}

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}
