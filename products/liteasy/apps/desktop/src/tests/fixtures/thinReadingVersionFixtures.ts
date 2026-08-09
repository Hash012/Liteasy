import type { AdvanceThinReadingDocumentInput } from "../../app/features/thin-reading/thinReading.types";

export const now = "2026-08-09T00:00:00.000Z";

export const branchInput: AdvanceThinReadingDocumentInput = {
  parentNodeId: "thin-reading-root-v1",
  source: { kind: "omitted_section", label: "Methods", sectionKey: "methods" },
  seed: {
    evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
    omittedSections: [],
    recommendations: [],
    summary: "The method details the bounded evidence chain.",
    withinPaperClosure: true
  },
  title: "Methods",
  createdAt: now
};

export const v1Fixture = {
  annotationSettings: { autoPublic: false },
  annotations: [{
    artifactId: "thin-v1-original",
    body: "Keep this note.",
    createdAt: now,
    excerpt: "bounded evidence chain",
    id: "annotation-1",
    nodeId: "thin-reading-root-v1",
    target: { kind: "node_summary", nodeId: "thin-reading-root-v1" },
    updatedAt: now,
    visibility: "private"
  }],
  artifactId: "thin-v1-original",
  paperIds: ["paper-1"],
  title: "A traceable paper",
  targetLanguage: "en-US",
  activeNodeId: "thin-reading-root-v1",
  nodes: {
    "thin-reading-root-v1": {
      childIds: [],
      closureState: "inside_paper",
      createdAt: now,
      depth: 0,
      evidence: {
        externalKnowledge: [],
        interactiveDemo: {
          description: "Legacy executable content.",
          html: "<!doctype html><html><body><svg viewBox='0 0 120 80'><rect x='12' y='16' width='36' height='20'/></svg></body></html>",
          kind: "html",
          title: "Legacy demo"
        },
        mermaid: "flowchart LR\nA-->B",
        paperEvidence: ["evidence-1"],
        recommendedFigures: [{ evidenceIds: ["evidence-1"], figureId: "figure-1", reason: "Original source figure." }]
      },
      id: "thin-reading-root-v1",
      omittedSections: [{ id: "section-methods", label: "Methods", sectionKey: "methods" }],
      recommendationScope: { kind: "whole_paper", paperId: "paper-1" },
      recommendations: [],
      source: { kind: "root_overview" },
      summary: "A traceable summary preserves the bounded evidence chain.",
      title: "A traceable paper",
      withinPaperClosure: true
    }
  },
  pendingPublicAnnotationIds: [],
  rootNodeId: "thin-reading-root-v1",
  version: "liteasy.thin-reading/v1"
} as const;
