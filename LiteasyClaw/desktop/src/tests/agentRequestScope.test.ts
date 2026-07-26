import { expect, test } from "vitest";
import { resolveAgentKnowledgeScope } from "../app/controllers/agent/agentRequestScope";
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
