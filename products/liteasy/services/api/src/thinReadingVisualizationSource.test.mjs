import assert from "node:assert/strict";
import test from "node:test";
import { resolveThinReadingVisualizationSource } from "./thinReadingVisualizationSource.mjs";

const contentHash = "a".repeat(64);

function thinReadingArtifact(overrides = {}) {
  const node = {
    childIds: [],
    createdAt: "2026-08-10T00:00:00.000Z",
    depth: 0,
    evidence: {
      externalKnowledge: [],
      paperEvidence: ["evidence-1"],
      paperEvidenceSpans: [{
        confidence: 0.9,
        id: "evidence-1",
        page: 2,
        paperId: "document-1",
        quote: "Self-attention replaces recurrence."
      }]
    },
    id: "node-1",
    omittedSections: [],
    recommendationScope: { kind: "whole_paper" },
    recommendations: [],
    source: { kind: "root_overview" },
    summary: "A bounded summary.",
    title: "Overview",
    visualizationDecision: {
      intent: {
        candidateModalities: ["semantic_graph"],
        evidenceIds: ["evidence-1"],
        expectedLearningGain: "high",
        nodeId: "node-1",
        purpose: "explain_structure",
        requestedBy: "automatic"
      },
      status: "accepted"
    },
    visualizations: [],
    withinPaperClosure: true,
    ...overrides.node
  };
  const document = {
    activeNodeId: "node-1",
    annotationSettings: { autoPublic: false },
    annotations: [],
    artifactId: "artifact-1",
    nodes: { "node-1": node },
    paperIds: ["document-1"],
    pendingPublicAnnotationIds: [],
    rootNodeId: "node-1",
    targetLanguage: "zh-CN",
    title: "Paper",
    version: "liteasy.thin-reading/v2",
    ...overrides.document
  };
  return {
    agent: { runId: "run-1", status: "completed" },
    answer: "summary",
    artifactId: "artifact-1",
    artifactType: "thin_reading",
    citations: [],
    createdAt: "2026-08-10T00:00:00.000Z",
    papers: [{ id: "document-1", title: "Paper" }],
    thinReadingDocument: document,
    title: "Paper",
    version: "liteasy.agent-artifact/v1",
    ...overrides.artifact
  };
}

function dependencies(artifact, options = {}) {
  const calls = [];
  return {
    calls,
    value: {
      agentArtifactRepository: {
        async get(subjectId, artifactId) {
          calls.push(["artifact", subjectId, artifactId]);
          return { artifact, revision: options.revision ?? 3 };
        }
      },
      pool: {
        async query(sql, values) {
          calls.push(["query", sql, values]);
          if (sql.includes("FROM library_entries entry")) {
            return { rows: options.paperRows ?? [{
              content_hash: contentHash,
              document_id: "document-1",
              scope_id: "user-1",
              scope_type: "user"
            }] };
          }
          if (sql.includes("FROM external_retrieval_cache")) {
            return { rows: options.metadataRows ?? [] };
          }
          if (sql.includes("FROM external_retrieval_pdf_grants")) {
            return { rows: options.grantRows ?? [] };
          }
          return { rows: [] };
        }
      }
    }
  };
}

test("resolves only current subject-authorized paper evidence and hashes its revision", async () => {
  const harness = dependencies(thinReadingArtifact());
  const result = await resolveThinReadingVisualizationSource({
    artifactId: "artifact-1",
    nodeId: "node-1",
    subjectId: "user-1"
  }, harness.value);

  assert.equal(result.artifactRevision, 3);
  assert.deepEqual(result.documents, [{
    documentId: "document-1",
    isPrimary: true,
    scopeId: "user-1",
    scopeType: "user",
    sourceIdentityHash: contentHash
  }]);
  assert.deepEqual(result.evidence, [{
    id: "evidence-1",
    kind: "paper",
    page: 2,
    paperId: "document-1",
    quote: "Self-attention replaces recurrence.",
    sourceIdentityHash: contentHash
  }]);
  assert.match(result.intentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.locale, "zh-CN");
  assert.deepEqual(harness.calls[0], ["artifact", "user-1", "artifact-1"]);
});

test("rejects v1, omitted, mismatched, and unbound thin-reading requests", async (t) => {
  const cases = [
    ["v1", thinReadingArtifact({ document: { version: "liteasy.thin-reading/v1" } })],
    ["omitted", thinReadingArtifact({ node: { visualizationDecision: { status: "omitted" } } })],
    ["node mismatch", thinReadingArtifact({ node: { visualizationDecision: {
      intent: {
        candidateModalities: ["semantic_graph"], evidenceIds: ["evidence-1"],
        expectedLearningGain: "high", nodeId: "node-other", purpose: "explain_structure", requestedBy: "automatic"
      }, status: "accepted"
    } } })],
    ["unknown evidence", thinReadingArtifact({ node: { visualizationDecision: {
      intent: {
        candidateModalities: ["semantic_graph"], evidenceIds: ["evidence-missing"],
        expectedLearningGain: "high", nodeId: "node-1", purpose: "explain_structure", requestedBy: "automatic"
      }, status: "accepted"
    } } })]
  ];
  for (const [name, artifact] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        () => resolveThinReadingVisualizationSource({
          artifactId: "artifact-1", nodeId: "node-1", subjectId: "user-1"
        }, dependencies(artifact).value),
        /thin_reading_visualization_source_invalid/
      );
    });
  }
});

test("rejects paper evidence when current source access is missing", async () => {
  await assert.rejects(
    () => resolveThinReadingVisualizationSource({
      artifactId: "artifact-1", nodeId: "node-1", subjectId: "user-1"
    }, dependencies(thinReadingArtifact(), { paperRows: [] }).value),
    /thin_reading_visualization_source_access_revoked/
  );
});

test("requires an unexpired subject-bound grant for external full-text evidence", async () => {
  const externalHash = "b".repeat(64);
  const externalSource = {
    abstract: "External abstract.",
    authors: ["Author"],
    evidenceBasis: "full_text",
    fullTextEvidence: [{
      contentHash: externalHash,
      finalUrl: "https://papers.example/full.pdf",
      id: "external-evidence-1",
      page: 4,
      quote: "External full-text evidence.",
      textExtraction: "embedded"
    }],
    fullTextGrantId: "pdfgrant-12345678",
    id: "external-source-1",
    localPdfContentHash: externalHash,
    provider: "openalex",
    relation: "related",
    relevance: 0.8,
    retrievalQuery: "query",
    sourceId: "W1",
    sourceRecordUrl: "https://openalex.org/W1",
    title: "External",
    url: "https://openalex.org/W1"
  };
  const artifact = thinReadingArtifact({ node: {
    evidence: {
      externalKnowledge: [externalSource.id],
      externalSources: [externalSource],
      paperEvidence: [],
      paperEvidenceSpans: []
    },
    visualizationDecision: {
      intent: {
        candidateModalities: ["semantic_graph"],
        evidenceIds: ["external-evidence-1"],
        expectedLearningGain: "medium",
        nodeId: "node-1",
        purpose: "show_evidence",
        requestedBy: "explicit_user_request"
      },
      status: "accepted"
    }
  } });
  await assert.rejects(
    () => resolveThinReadingVisualizationSource({
      artifactId: "artifact-1", nodeId: "node-1", subjectId: "user-1"
    }, dependencies(artifact).value),
    /thin_reading_visualization_external_grant_invalid/
  );

  const result = await resolveThinReadingVisualizationSource({
    artifactId: "artifact-1", nodeId: "node-1", subjectId: "user-1"
  }, dependencies(artifact, { grantRows: [{
    connector_source_id: "source-config-1",
    connector_type: "openalex",
    grant_id: "pdfgrant-12345678",
    source_id: "external-source-1",
    source_record_id: "W1",
    source_url: "https://papers.example/full.pdf"
  }] }).value);
  assert.equal(result.evidence[0].kind, "external_full_text");
  assert.equal(result.documents[0].isPrimary, true);
});

test("requires a current subject cache record for external metadata evidence", async () => {
  const source = {
    abstract: "External abstract.",
    authors: ["Author"],
    id: "external-source-1",
    provider: "openalex",
    relation: "related",
    relevance: 0.8,
    retrievalQuery: "query",
    sourceId: "W1",
    sourceRecordUrl: "https://openalex.org/W1",
    title: "External",
    url: "https://openalex.org/W1"
  };
  const artifact = thinReadingArtifact({ node: {
    evidence: { externalKnowledge: [source.id], externalSources: [source], paperEvidence: [], paperEvidenceSpans: [] },
    visualizationDecision: { intent: {
      candidateModalities: ["semantic_graph"], evidenceIds: [source.id], expectedLearningGain: "medium",
      nodeId: "node-1", purpose: "show_evidence", requestedBy: "explicit_user_request"
    }, status: "accepted" }
  } });
  await assert.rejects(
    () => resolveThinReadingVisualizationSource({
      artifactId: "artifact-1", nodeId: "node-1", subjectId: "user-1"
    }, dependencies(artifact).value),
    /thin_reading_visualization_external_source_expired/
  );
  const resolved = await resolveThinReadingVisualizationSource({
    artifactId: "artifact-1", nodeId: "node-1", subjectId: "user-1"
  }, dependencies(artifact, { metadataRows: [{ cache_key: "c".repeat(64), cached_source: source }] }).value);
  assert.equal(resolved.evidence[0].abstract, "External abstract.");
});
