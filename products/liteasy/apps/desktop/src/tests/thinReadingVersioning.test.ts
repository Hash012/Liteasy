import { expect, test } from "vitest";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import {
  cloneThinReadingV1AsV2,
  parseThinReadingDocument
} from "../app/features/thin-reading/thinReadingVersioning";
import { branchInput, now, v1Fixture } from "./fixtures/thinReadingVersionFixtures";

test("parses v1 for display but refuses an in-place branch mutation", () => {
  const oldDocument = parseThinReadingDocument(v1Fixture);

  expect(oldDocument.version).toBe("liteasy.thin-reading/v1");
  expect(() => advanceThinReadingDocument(oldDocument, branchInput))
    .toThrow("thin_reading_v1_read_only");
});

test("clones v1 into a new v2 artifact before deepening", () => {
  const next = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-1", createdAt: now });

  expect(next.version).toBe("liteasy.thin-reading/v2");
  expect(next.artifactId).toBe("thin-copy-1");
  expect(next.nodes[next.rootNodeId].visualizations).toEqual([]);
  expect(next.nodes[next.rootNodeId].evidence).not.toHaveProperty("interactiveDemo");
  expect(next.nodes[next.rootNodeId].evidence).not.toHaveProperty("mermaid");
  expect(next.nodes[next.rootNodeId]).not.toHaveProperty("version");
  expect(next.migrationProvenance).toEqual({
    migratedAt: now,
    sourceArtifactId: "thin-v1-original"
  });
});

test("rejects v2 documents that retain executable legacy evidence or malformed visualizations", () => {
  const next = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-2", createdAt: now });
  const root = next.nodes[next.rootNodeId];

  expect(() => parseThinReadingDocument({
    ...next,
    nodes: {
      ...next.nodes,
      [next.rootNodeId]: {
        ...root,
        evidence: { ...root.evidence, mermaid: "flowchart LR\nA-->B" }
      }
    }
  })).toThrow("thin_reading_document_invalid");

  expect(() => parseThinReadingDocument({
    ...next,
    nodes: {
      ...next.nodes,
      [next.rootNodeId]: { ...root, visualizations: [{}] }
    }
  })).toThrow("thin_reading_document_invalid");
});

test("creates v2 documents without executable legacy evidence", () => {
  const document = createThinReadingDocument({
    artifactId: "thin-new-v2",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
      omittedSections: [],
      recommendations: [],
      summary: "A safe new document.",
      withinPaperClosure: true
    },
    targetLanguage: "en-US"
  });

  expect(document.version).toBe("liteasy.thin-reading/v2");
  expect(document.nodes[document.rootNodeId].visualizations).toEqual([]);
});
