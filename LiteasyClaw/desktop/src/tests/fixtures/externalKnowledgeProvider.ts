import type { MindmapExternalReferenceSource } from "../../app/features/artifact-workflow/mindmapArtifact.types";
import type { ExternalKnowledgeProvider } from "../../app/features/artifact-workflow/externalKnowledgeProvider";

const references: Record<string, MindmapExternalReferenceSource> = {
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
  }
};

export function createTestExternalKnowledgeProvider(): ExternalKnowledgeProvider {
  return {
    async lookup(input) {
      const matches = input.terms
        .map((term) => references[term.trim().toLowerCase()])
        .filter((reference): reference is MindmapExternalReferenceSource => Boolean(reference));
      return [...new Map(matches.map((reference) => [reference.refId, reference])).values()];
    }
  };
}
