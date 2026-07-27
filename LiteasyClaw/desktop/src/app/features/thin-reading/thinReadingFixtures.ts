import type { CreateThinReadingDocumentInput } from "./thinReading.types";

export function createThinReadingFixture(): CreateThinReadingDocumentInput {
  return Object.freeze({
    artifactId: "artifact-thin-fixture",
    papers: Object.freeze([
      Object.freeze({ id: "paper-attention", title: "Attention Is All You Need" }),
      Object.freeze({
        id: "paper-bert",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      })
    ]),
    targetLanguage: "zh-CN",
    importedChunksByPaperId: Object.freeze({
      "paper-attention": Object.freeze(["Self-attention replaces recurrence in the encoder."]),
      "paper-bert": Object.freeze(["Pre-training provides bidirectional language context."])
    })
  });
}
