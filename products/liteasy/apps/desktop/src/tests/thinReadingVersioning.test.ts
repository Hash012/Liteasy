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

test("parses v2 nodes with typed visualization requests while retaining v1 command compatibility", () => {
  const document = createThinReadingDocument({
    artifactId: "thin-typed-request",
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
  const next = advanceThinReadingDocument(document, {
    parentNodeId: document.rootNodeId,
    seed: {
      evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
      omittedSections: [],
      recommendations: [],
      summary: "The request asks for a typed structure visualization.",
      withinPaperClosure: true
    },
    source: {
      excerpt: "A typed structure request.",
      kind: "selected_text",
      quickCommand: "visualize_structure",
      requestedOutput: "visualization_intent"
    },
    title: "Structure"
  });

  expect(parseThinReadingDocument(next).version).toBe("liteasy.thin-reading/v2");
});

test("reuses the persisted annotation bounds for v1 parsing", () => {
  const publicAnnotation = {
    ...v1Fixture.annotations[0],
    id: "annotation-public",
    visibility: "pending_public" as const
  };

  expect(parseThinReadingDocument({
    ...v1Fixture,
    annotations: [publicAnnotation],
    pendingPublicAnnotationIds: [publicAnnotation.id]
  }).version).toBe("liteasy.thin-reading/v1");

  expect(() => parseThinReadingDocument({
    ...v1Fixture,
    pendingPublicAnnotationIds: [v1Fixture.annotations[0].id]
  })).toThrow("thin_reading_document_invalid");
});

test("rejects malformed persisted node bounds for both document versions", () => {
  expect(() => parseThinReadingDocument({
    ...v1Fixture,
    nodes: {
      ...v1Fixture.nodes,
      [v1Fixture.rootNodeId]: { ...v1Fixture.nodes[v1Fixture.rootNodeId], childIds: ["missing"] }
    }
  })).toThrow("thin_reading_document_invalid");

  const v2 = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-invalid", createdAt: now });
  expect(() => parseThinReadingDocument({
    ...v2,
    nodes: {
      ...v2.nodes,
      [v2.rootNodeId]: { ...v2.nodes[v2.rootNodeId], evidence: { ...v2.nodes[v2.rootNodeId].evidence, paperEvidence: ["duplicate", "duplicate"] } }
    }
  })).toThrow("thin_reading_document_invalid");
});

test("rejects an empty persisted artifact identity", () => {
  expect(() => parseThinReadingDocument({
    ...v1Fixture,
    annotations: v1Fixture.annotations.map((annotation) => ({ ...annotation, artifactId: "" })),
    artifactId: ""
  }))
    .toThrow("thin_reading_document_invalid");
});
