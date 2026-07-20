import {
  buildAnalysisSubtasks,
  generateAssistantAnswer
} from "../app/features/assistant/generateAssistantAnswer";
import {
  completeMultiPaperAnalysis,
  prepareMultiPaperAnalysis
} from "../app/features/paper-analysis/multiPaperAnalysisWorkflow";
import type { RetrievalChunk } from "../app/features/retrieval/retrieval.types";
import { createSettingsStore } from "../app/features/settings/settings.store";

function chunk(
  paperId: string,
  paperTitle: string,
  page: number,
  summary: string,
  tags: string[]
): RetrievalChunk {
  return {
    page,
    paperId,
    paperTitle,
    snippet: `${summary} original evidence`,
    summary,
    tags
  };
}

function createIdFactory() {
  let sequence = 0;
  return (kind: "analysis" | "claim" | "evidence") => {
    sequence += 1;
    return `${kind}-${sequence}`;
  };
}

test("retrieves bounded evidence with a fair per-paper first pass", () => {
  const papers = [
    { id: "paper-a", title: "Paper A" },
    { id: "paper-b", title: "Paper B" },
    { id: "paper-c", title: "Paper C" }
  ];
  const prepared = prepareMultiPaperAnalysis({
    createId: createIdFactory(),
    importedChunksByPaperId: {
      "paper-a": [
        chunk("paper-a", "Paper A", 1, "retrieval method A", ["retrieval"]),
        chunk("paper-a", "Paper A", 2, "secondary result A", ["result"])
      ],
      "paper-b": [
        chunk("paper-b", "Paper B", 3, "retrieval method B", ["retrieval"]),
        chunk("paper-b", "Paper B", 4, "secondary result B", ["result"])
      ],
      "paper-c": [
        chunk("paper-c", "Paper C", 5, "retrieval method C", ["retrieval"]),
        chunk("paper-c", "Paper C", 6, "secondary result C", ["result"])
      ]
    },
    limits: { maxEvidencePerPaper: 2, maxTotalEvidence: 3 },
    now: () => new Date("2026-07-20T01:00:00.000Z"),
    query: "compare retrieval methods",
    selectedPapers: papers
  });

  expect(prepared.evidence).toHaveLength(3);
  expect(prepared.evidence.map((item) => item.paperId)).toEqual([
    "paper-a",
    "paper-b",
    "paper-c"
  ]);
  expect(prepared.run.coverage).toEqual({
    coveredPaperIds: ["paper-a", "paper-b", "paper-c"],
    missingPaperIds: [],
    ratio: 1,
    selectedPaperIds: ["paper-a", "paper-b", "paper-c"]
  });
  expect(prepared.evidencePrompt).toContain(`[${prepared.evidence[0].id}] Paper A p.1`);
});

test("uses adaptive stratified coverage instead of collapsing a paper to a few top chunks", () => {
  const evidenceChunks = Array.from({ length: 40 }, (_, index) =>
    chunk(
      "paper-a",
      "Paper A",
      index + 1,
      index < 10 ? `retrieval method ${index}` : `paper section ${index}`,
      index < 10 ? ["retrieval"] : ["section"]
    )
  );
  const prepared = prepareMultiPaperAnalysis({
    createId: createIdFactory(),
    importedChunksByPaperId: { "paper-a": evidenceChunks },
    query: "retrieval method",
    selectedPapers: [{ id: "paper-a", title: "Paper A" }]
  });

  expect(prepared.evidence).toHaveLength(28);
  expect(prepared.run.plan.maxEvidencePerPaper).toBe(28);
  expect(Math.max(...prepared.evidence.map((item) => item.page))).toBeGreaterThan(30);
  expect(new Set(prepared.evidence.map((item) => item.page)).size).toBeGreaterThan(20);
});

test("splits one paper into parallel section-analysis subtasks", () => {
  const prepared = prepareMultiPaperAnalysis({
    createId: createIdFactory(),
    importedChunksByPaperId: {
      "paper-a": Array.from({ length: 16 }, (_, index) =>
        chunk("paper-a", "Paper A", index + 1, `section ${index + 1}`, ["section"])
      )
    },
    query: "deep analysis",
    selectedPapers: [{ id: "paper-a", title: "Paper A" }]
  });
  const tasks = buildAnalysisSubtasks(prepared);

  expect(tasks).toHaveLength(4);
  expect(tasks.map((task) => task.id)).toEqual([
    "section:paper-a:1",
    "section:paper-a:2",
    "section:paper-a:3",
    "section:paper-a:4"
  ]);
  expect(tasks.flatMap((task) => task.evidencePrompt.match(/\[evidence-/g) ?? []))
    .toHaveLength(prepared.evidence.length);
});

test("assigns one parallel analysis subtask per paper for comparison artifacts", () => {
  const prepared = prepareMultiPaperAnalysis({
    createId: createIdFactory(),
    importedChunksByPaperId: {
      "paper-a": [chunk("paper-a", "Paper A", 1, "method A", ["method"])],
      "paper-b": [chunk("paper-b", "Paper B", 2, "method B", ["method"])]
    },
    query: "compare methods",
    selectedPapers: [
      { id: "paper-a", title: "Paper A" },
      { id: "paper-b", title: "Paper B" }
    ]
  });

  expect(buildAnalysisSubtasks(prepared)).toEqual([
    expect.objectContaining({ id: "paper:paper-a", paperTitle: "Paper A" }),
    expect.objectContaining({ id: "paper:paper-b", paperTitle: "Paper B" })
  ]);
});

test("marks synthesis for review when a selected paper has no evidence", () => {
  const createId = createIdFactory();
  const prepared = prepareMultiPaperAnalysis({
    createId,
    importedChunksByPaperId: {
      "paper-a": [chunk("paper-a", "Paper A", 1, "method A", ["method"])]
    },
    query: "compare methods",
    selectedPapers: [
      { id: "paper-a", title: "Paper A" },
      { id: "paper-b", title: "Paper B" }
    ]
  });
  const completed = completeMultiPaperAnalysis({
    answer: "Paper A has evidence, while Paper B is unknown.",
    auditScore: 0.9,
    auditVerdict: "pass",
    createId,
    now: () => new Date("2026-07-20T01:01:00.000Z"),
    prepared
  });

  expect(completed.run.status).toBe("needs_review");
  expect(completed.run.coverage.missingPaperIds).toEqual(["paper-b"]);
  expect(completed.claims.at(-1)).toMatchObject({
    evidenceIds: prepared.evidence.map((item) => item.id),
    stance: "mixed"
  });
});

test("honors cancellation before analysis starts", () => {
  const abortController = new AbortController();
  abortController.abort();

  expect(() => prepareMultiPaperAnalysis({
    importedChunksByPaperId: {},
    query: "compare",
    selectedPapers: [],
    signal: abortController.signal
  })).toThrow("Multi-paper analysis was cancelled");
});

test("assistant generation uses the evidence matrix and returns an auditable analysis", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "All claims have evidence.",
          score: 0.92,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "paper-a": [chunk("paper-a", "Paper A", 2, "method A uses sparse retrieval", ["method"])],
      "paper-b": [chunk("paper-b", "Paper B", 5, "method B uses dense retrieval", ["method"])]
    },
    mode: "qa",
    modelTransport: async (request) => {
      prompts.push(JSON.parse(request.body).prompt as string);
      return {
        json: async () => ({
          answer: "Paper A uses sparse retrieval; Paper B uses dense retrieval.",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "compare methods",
    selectedPapers: [
      { id: "paper-a", title: "Paper A" },
      { id: "paper-b", title: "Paper B" }
    ],
    settings: store.getState()
  });

  expect(prompts[0]).toContain("多论文分析规则");
  expect(prompts[0]).toContain("证据矩阵");
  expect(prompts[0]).toContain("Paper A p.2");
  expect(prompts[0]).toContain("Paper B p.5");
  expect(result.citations.map((citation) => citation.paperId)).toEqual([
    "paper-a",
    "paper-b"
  ]);
  expect(result.analysis).toMatchObject({
    run: {
      coverage: { ratio: 1 },
      status: "completed"
    }
  });
  expect(result.analysis?.claims.at(-1)).toMatchObject({
    evidenceIds: result.analysis.evidence.map((item) => item.id),
    stance: "supported"
  });
});

test("runs section-analysis model calls before the final artifact synthesis", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const result = await generateAssistantAnswer({
    artifactType: "tree",
    auditTransport: async () => ({
      json: async () => ({ audit: { rationale: "grounded", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "paper-a": Array.from({ length: 12 }, (_, index) =>
        chunk("paper-a", "Paper A", index + 1, `method section ${index + 1}`, ["method"])
      )
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = JSON.parse(request.body).prompt as string;
      prompts.push(prompt);
      return {
        json: async () => ({
          answer: prompt.includes("并行分析子任务记录")
            ? "- Paper A\n  - Method details [evidence-1]"
            : "subtask report",
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "deep tree analysis",
    selectedPapers: [{ id: "paper-a", title: "Paper A" }],
    settings: store.getState()
  });

  expect(prompts.filter((prompt) => prompt.includes("并行子任务"))).toHaveLength(4);
  expect(prompts.at(-1)).toContain("并行分析子任务记录");
  expect(result.answer).toContain("Method details");
});

test("a single selected paper still creates AnalysisRun metadata for modal output", async () => {
  const result = await generateAssistantAnswer({
    artifactType: "mindmap",
    importedChunksByPaperId: {
      "paper-a": [chunk("paper-a", "Paper A", 2, "method A evidence", ["method"])]
    },
    mode: "qa",
    question: "generate a mind map",
    selectedPapers: [{ id: "paper-a", title: "Paper A" }],
    settings: createSettingsStore().getState()
  });

  expect(result.analysis).toMatchObject({
    evidence: [expect.objectContaining({ paperId: "paper-a" })],
    run: {
      coverage: { ratio: 1 },
      status: "completed"
    }
  });
});
