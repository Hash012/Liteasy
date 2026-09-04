import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { createArtifactMarkdown } from "../app/features/artifacts/artifactDocumentExport";
import { generateAssistantAnswer } from "../app/features/assistant/generateAssistantAnswer";
import { extractPdfIndexForPaper } from "../app/features/import/pdfTextExtractor";
import type { ModelTransport } from "../app/features/models/modelHttpClient";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { fileWorkflowTestPaper } from "./fixtures/fileWorkflowTestFixture";

const liveEndpoint = process.env.LITEASY_FILE_WORKFLOW_LIVE_ENDPOINT;
const liveProvider = process.env.LITEASY_FILE_WORKFLOW_LIVE_PROVIDER ?? "deepseek";
const liveOutput = process.env.LITEASY_FILE_WORKFLOW_LIVE_OUTPUT;
const liveTest = liveEndpoint ? test : test.skip;

liveTest("runs the registered PDF through the real thin-reading model path", async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  )).href;
  const fixturePath = resolve(
    process.cwd(),
    "../../../../development/test-data/file-workflow-test/larimar-episodic-memory.pdf"
  );
  const bytes = await readFile(fixturePath);
  const paper = {
    contentHash: fileWorkflowTestPaper.contentHash,
    id: fileWorkflowTestPaper.id,
    sourcePath: fileWorkflowTestPaper.publicPath,
    title: fileWorkflowTestPaper.title
  };
  const extraction = await extractPdfIndexForPaper(paper, {
    loadPdfSource: async () => new Uint8Array(bytes),
    ocrLanguage: "eng"
  });

  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: liveEndpoint as string
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: liveProvider
  });

  const artifactId = "file-workflow-test-larimar-thin-reading";
  const question = [
    "通读 Larimar 论文并生成中文深度薄读。",
    "必须覆盖情景记忆架构、记忆写入与读取、知识编辑实验、推理速度和论文局限。",
    "如果证据足以形成比正文更清晰的结构说明，请给出证据绑定的可视化意图。"
  ].join("");
  const modelCalls: Array<{ request: unknown; response: unknown; status: number }> = [];
  const modelTransport: ModelTransport = async (request) => {
    const response = await fetch(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
      signal: request.signal
    });
    const payload = await response.json();
    modelCalls.push({
      request: JSON.parse(request.body),
      response: payload,
      status: response.status
    });
    return {
      json: async () => payload,
      ok: response.ok,
      status: response.status
    };
  };
  const writeBundle = async (fileName: string, payload: unknown) => {
    if (!liveOutput) return;
    const outputDirectory = resolve(process.cwd(), liveOutput);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(resolve(outputDirectory, fileName), JSON.stringify(payload, null, 2));
  };
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    enableVisualizationDecisionPlanner: true,
    importedChunksByPaperId: { [paper.id]: extraction.chunks },
    mode: "qa",
    modelTransport,
    question,
    selectedPapers: [paper],
    settings: store.getState(),
    thinReadingContext: {
      artifactId,
      depth: 0,
      paperIds: [paper.id],
      primaryPaperId: paper.id,
      primaryPaperTitle: paper.title,
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  }).catch(async (error) => {
    await writeBundle("failure.json", {
      error: error instanceof Error ? error.message : String(error),
      extraction,
      input: { paper, question },
      modelCalls
    });
    throw error;
  });

  expect(result.thinReading).toBeDefined();
  expect(result.thinReading?.rootSeed.summary.length).toBeGreaterThan(100);
  expect(result.thinReading?.rootSeed.evidence.paperEvidenceSpans).not.toHaveLength(0);
  expect(result.thinReading?.rootSeed.evidence.summarySentences?.every((sentence) =>
    sentence.status === "unsupported" || sentence.evidenceIds.length > 0
  )).toBe(true);

  const document = createThinReadingDocument({
    artifactId,
    papers: [paper],
    rootSeed: result.thinReading!.rootSeed,
    targetLanguage: "zh-CN"
  });
  const markdown = createArtifactMarkdown({
    analysis: result.analysis,
    answer: result.content,
    artifactId,
    citations: result.citations,
    mineruTextChunks: extraction.chunks,
    papers: [paper],
    thinReadingDocument: document,
    title: `薄读：${paper.title}`,
    type: "thin_reading"
  });
  expect(markdown).toContain(`# 薄读：${paper.title}`);
  expect(markdown).toContain("## Agent 分析");
  expect(markdown).not.toContain("rendererId");
  expect(markdown).not.toContain("providerRouteId");

  if (liveOutput) {
    const outputDirectory = resolve(process.cwd(), liveOutput);
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(resolve(outputDirectory, "result.json"), JSON.stringify({
        document,
        extraction,
        input: { paper, question },
        modelCalls,
        result
      }, null, 2)),
      writeFile(resolve(outputDirectory, "result.md"), markdown)
    ]);
  }

  console.log(JSON.stringify({
    chunks: extraction.chunks.length,
    pages: extraction.pages.length,
    summaryCharacters: result.thinReading?.rootSeed.summary.length,
    visualizationIntent: result.thinReading?.rootSeed.visualizationIntent ?? null
  }));
}, 300_000);
