import type { MindmapExternalReferenceSource } from "./mindmapArtifact.types";

export type ExternalKnowledgeLookupInput = {
  question: string;
  terms: string[];
  timeoutMs: number;
};

export type ExternalKnowledgeProvider = {
  lookup: (input: ExternalKnowledgeLookupInput) => Promise<MindmapExternalReferenceSource[]>;
};
