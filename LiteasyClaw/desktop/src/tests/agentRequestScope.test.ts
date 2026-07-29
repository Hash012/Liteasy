import { expect, test } from "vitest";
import {
  getAgentRequestThinReadingContext,
  resolveAgentKnowledgeScope
} from "../app/controllers/agent/agentRequestScope";
import type { Paper } from "../app/features/workspace/workspace.types";

const papers: Paper[] = [
  { id: "paper-a", title: "Paper A" },
  { id: "paper-b", title: "Paper B" },
  { id: "paper-c", title: "Paper C" }
];

test("resolves request-scoped papers and chunks from selection attachments", () => {
  const scope = resolveAgentKnowledgeScope({
    allPapers: papers,
    fallbackImportedChunksByPaperId: {
      "paper-a": [{ chunkId: "chunk-a", page: 1, paperId: "paper-a", text: "A" }],
      "paper-b": [{ chunkId: "chunk-b", page: 2, paperId: "paper-b", text: "B" }]
    },
    fallbackSelectedPapers: [papers[0]],
    getImportedChunksForPaperId: (paperId) => [
      { chunkId: `chunk-${paperId}`, page: 1, paperId, text: paperId }
    ],
    request: {
      attachments: [
        {
          metadata: {
            paperIds: ["paper-b", "paper-c"]
          },
          source: "selection",
          uri: "liteasy://selection/current"
        }
      ],
      idempotencyKey: "artifact:mindmap:test",
      input: {
        artifactType: "mindmap",
        message: "生成指定论文思维导图",
        mode: "qa"
      },
      sessionId: "session-1"
    }
  });

  expect(scope.selectedPapers.map((paper) => paper.id)).toEqual(["paper-b", "paper-c"]);
  expect(Object.keys(scope.importedChunksByPaperId)).toEqual(["paper-b", "paper-c"]);
  expect(scope.importedChunksByPaperId["paper-c"][0].text).toBe("paper-c");
});

test("preserves reader-prioritized paper order and thin-reading context", () => {
  const request = {
    attachments: [
      {
        metadata: {
          paperIds: ["paper-c", "paper-a"],
          thinReadingContext: {
            artifactId: "artifact-thin",
            depth: 0,
            paperIds: ["paper-c", "paper-a"],
            primaryPaperId: "paper-c",
            primaryPaperIdentity: {
              id: "doi:10.1000/paper-c",
              kind: "doi" as const,
              source: "metadata" as const,
              value: "10.1000/paper-c"
            },
            primaryPaperTitle: "Paper C",
            parentClaims: [
              {
                evidenceIds: ["evidence-parent"],
                id: "claim-parent",
                status: "grounded",
                text: "上一层认为 Paper C 的核心贡献是检索结构。"
              }
            ],
            parentEvidenceSpans: [
              {
                chunkId: "paper-c:p2:chunk-1",
                confidence: 0.88,
                id: "evidence-parent",
                page: 2,
                pageTextEnd: 49,
                pageTextStart: 5,
                paperId: "paper-c",
                quote: "Paper C introduces a retrieval structure."
              }
            ],
            source: { kind: "root_overview" },
            targetLanguage: "zh-CN"
          }
        },
        source: "selection" as const,
        uri: "liteasy://selection/current"
      }
    ],
    idempotencyKey: "artifact:thin:test",
    input: {
      artifactType: "thin_reading" as const,
      message: "生成薄读",
      mode: "qa" as const
    },
    sessionId: "session-1"
  };
  const scope = resolveAgentKnowledgeScope({
    allPapers: papers,
    fallbackImportedChunksByPaperId: {},
    fallbackSelectedPapers: [papers[0]],
    request
  });

  expect(scope.selectedPapers.map((paper) => paper.id)).toEqual(["paper-c", "paper-a"]);
  expect(getAgentRequestThinReadingContext(request)).toMatchObject({
    artifactId: "artifact-thin",
    parentClaims: [
      expect.objectContaining({
        evidenceIds: ["evidence-parent"],
        id: "claim-parent"
      })
    ],
    parentEvidenceSpans: [
      expect.objectContaining({
        id: "evidence-parent",
        page: 2,
        pageTextEnd: 49,
        pageTextStart: 5,
        quote: expect.stringContaining("retrieval structure")
      })
    ],
    primaryPaperId: "paper-c",
    primaryPaperIdentity: {
      id: "doi:10.1000/paper-c",
      kind: "doi",
      source: "metadata",
      value: "10.1000/paper-c"
    },
    source: { kind: "root_overview" }
  });

  const malformedIdentityRequest = structuredClone(request);
  malformedIdentityRequest.attachments[0].metadata.thinReadingContext.primaryPaperIdentity.id =
    "doi:10.1000/different-paper";
  expect(getAgentRequestThinReadingContext(malformedIdentityRequest)?.primaryPaperIdentity).toBeUndefined();
});

test("falls back to the current selected context without a selection attachment", () => {
  const scope = resolveAgentKnowledgeScope({
    allPapers: papers,
    fallbackImportedChunksByPaperId: {
      "paper-a": [{ chunkId: "chunk-a", page: 1, paperId: "paper-a", text: "A" }]
    },
    fallbackSelectedPapers: [papers[0]]
  });

  expect(scope.selectedPapers).toEqual([papers[0]]);
  expect(scope.importedChunksByPaperId).toEqual({
    "paper-a": [{ chunkId: "chunk-a", page: 1, paperId: "paper-a", text: "A" }]
  });
});

test("normalizes selected-passage evidence ids and rejects malformed attachment metadata", () => {
  const request = {
    attachments: [{
      metadata: {
        thinReadingContext: {
          artifactId: "artifact-thin-branch",
          depth: 1,
          paperIds: ["paper-a"],
          source: {
            evidenceIds: ["evidence-selected", "evidence-selected", "evidence-boundary"],
            externalSourceIds: ["openalex:W42", "openalex:W42"],
            excerpt: "the selected passage",
            kind: "selected_text" as const
          },
          targetLanguage: "en-US"
        }
      },
      source: "selection" as const,
      uri: "liteasy://selection/current"
    }],
    idempotencyKey: "artifact:thin:branch",
    input: { artifactType: "thin_reading" as const, message: "deepen", mode: "qa" as const },
    sessionId: "session-branch"
  };

  expect(getAgentRequestThinReadingContext(request)?.source).toEqual({
    evidenceIds: ["evidence-selected", "evidence-boundary"],
    externalSourceIds: ["openalex:W42"],
    excerpt: "the selected passage",
    kind: "selected_text"
  });

  const malformed = structuredClone(request);
  malformed.attachments[0].metadata.thinReadingContext.source.evidenceIds = [42] as unknown as string[];
  expect(getAgentRequestThinReadingContext(malformed)).toBeNull();

  const overlongSelection = structuredClone(request);
  overlongSelection.attachments[0].metadata.thinReadingContext.source.excerpt = "x".repeat(1_601);
  expect(getAgentRequestThinReadingContext(overlongSelection)).toBeNull();

  const overlongPrompt = structuredClone(request);
  overlongPrompt.attachments[0].metadata.thinReadingContext.source.prompt = "x".repeat(601);
  expect(getAgentRequestThinReadingContext(overlongPrompt)).toBeNull();

  const overlongSection = structuredClone(request) as unknown as {
    attachments: Array<{ metadata: { thinReadingContext: { source: unknown } } }>;
  };
  overlongSection.attachments[0].metadata.thinReadingContext.source = {
    kind: "omitted_section",
    label: "x".repeat(49),
    sectionKey: "method"
  };
  expect(getAgentRequestThinReadingContext(
    overlongSection as Parameters<typeof getAgentRequestThinReadingContext>[0]
  )).toBeNull();
});

test("requires carried external sources to exactly match the selected external source ids", () => {
  const selectedSource = {
    abstract: "A verified follow-up study.",
    authors: ["A. Author"],
    id: "openalex:W42",
    provider: "openalex" as const,
    relation: "related" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up",
    sourceId: "W42",
    sourceRecordUrl: "https://openalex.org/W42",
    title: "A Follow-up Study",
    url: "https://openalex.org/W42",
    year: 2025
  };
  const request = {
    attachments: [{
      metadata: {
        thinReadingContext: {
          artifactId: "artifact-thin-external-selection",
          depth: 2,
          paperIds: ["paper-a"],
          selectedExternalSources: [selectedSource],
          source: {
            externalSourceIds: [selectedSource.id],
            excerpt: selectedSource.title,
            kind: "selected_text" as const
          },
          targetLanguage: "en-US"
        }
      },
      source: "selection" as const,
      uri: "liteasy://selection/current"
    }],
    idempotencyKey: "artifact:thin:external-selection",
    input: { artifactType: "thin_reading" as const, message: "deepen", mode: "qa" as const },
    sessionId: "session-external-selection"
  };

  expect(getAgentRequestThinReadingContext(request)?.selectedExternalSources).toEqual([selectedSource]);

  const mismatched = structuredClone(request);
  mismatched.attachments[0].metadata.thinReadingContext.source.externalSourceIds = ["openalex:W99"];
  expect(getAgentRequestThinReadingContext(mismatched)).toBeNull();
});

test("preserves strict Crossref topic-search provenance while rejecting a forged citation relation", () => {
  const request = {
    attachments: [{
      metadata: {
        thinReadingContext: {
          artifactId: "artifact-thin-crossref",
          depth: 3,
          externalSources: [
            {
              abstract: "A verified Crossref topic result.",
              authors: ["A. Author"],
              doi: "https://doi.org/10.1038/s41586-021-03819-2",
              id: "crossref:10.1038/s41586-021-03819-2",
              provider: "crossref" as const,
              relation: "topic_search" as const,
              relevance: 0.9,
              retrievalQuery: "protein structure prediction",
              sourceId: "10.1038/s41586-021-03819-2",
              sourceRecordUrl: "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2",
              title: "Highly accurate protein structure prediction with AlphaFold",
              url: "https://doi.org/10.1038/s41586-021-03819-2"
            },
            {
              abstract: "Forged relation must not survive normalization.",
              authors: [],
              doi: "https://doi.org/10.1000/forged",
              id: "crossref:10.1000/forged",
              provider: "crossref" as const,
              relation: "cites_target" as const,
              relevance: 1,
              retrievalQuery: "forged",
              sourceId: "10.1000/forged",
              sourceRecordUrl: "https://api.crossref.org/works/10.1000%2Fforged",
              title: "Forged Crossref relation",
              url: "https://doi.org/10.1000/forged"
            }
          ],
          paperIds: ["paper-a"],
          source: { kind: "selected_text" as const, excerpt: "an external extension" },
          targetLanguage: "en-US"
        }
      },
      source: "selection" as const,
      uri: "liteasy://selection/current"
    }],
    idempotencyKey: "artifact:thin:crossref",
    input: { artifactType: "thin_reading" as const, message: "deepen", mode: "qa" as const },
    sessionId: "session-crossref"
  };

  expect(getAgentRequestThinReadingContext(request)?.externalSources).toEqual([
    expect.objectContaining({
      id: "crossref:10.1038/s41586-021-03819-2",
      provider: "crossref",
      relation: "topic_search"
    })
  ]);
});
