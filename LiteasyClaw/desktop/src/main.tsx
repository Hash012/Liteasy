import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import App from "./App";
import { ThinReadingTab } from "./app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "./app/features/thin-reading/thinReadingFixtures";
import { advanceThinReadingDocument, createThinReadingDocument } from "./app/features/thin-reading/thinReadingProjection";
import type { CreateThinReadingDocumentInput } from "./app/features/thin-reading/thinReading.types";
import { extractPdfPages } from "./app/features/import/pdfTextExtractor";
import { PdfReader } from "./app/features/pdf/PdfReader";
import { PaperResourceTab } from "./app/features/import/PaperResourceTab";
import { DynamicCanvas } from "./app/features/generative-ui/DynamicCanvas";
import type { UIDslDocument } from "./app/features/generative-ui/generativeUi.types";
import { ArtifactTabs } from "./app/features/artifacts/ArtifactTabs";
import "./app/styles/app.css";

const browserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-fixture");
const mindmapBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-mindmap-fixture");
const externalBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-external-fixture");
const ocrBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-ocr-fixture");
const progressBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-progress-fixture");
const readerEvidenceBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-reader-evidence-fixture");
const paperResourceBrowserFixture = import.meta.env.DEV && window.location.search.includes("paper-resource-fixture");
const paperResourceFallbackBrowserFixture = import.meta.env.DEV && window.location.search.includes("paper-resource-fallback-fixture");
const generatedMindmapBrowserFixture = import.meta.env.DEV && window.location.search.includes("generated-mindmap-fixture");
const artifactExportBrowserFixture = import.meta.env.DEV && window.location.search.includes("artifact-export-fixture");

function createExternalThinReadingFixture() {
  const fixture = createThinReadingFixture();
  const sourceId = "crossref:10.1038/s41586-021-03819-2";
  return {
    ...fixture,
    rootSeed: {
      ...fixture.rootSeed,
      evidence: {
        ...fixture.rootSeed.evidence,
        externalKnowledge: [sourceId],
        externalSources: [{
          abstract: "A verified Crossref topic result.",
          authors: ["J. Jumper"],
          doi: "https://doi.org/10.1038/s41586-021-03819-2",
          id: sourceId,
          provider: "crossref" as const,
          relation: "topic_search" as const,
          relevance: 0.9,
          retrievalQuery: "protein structure prediction",
          sourceId: "10.1038/s41586-021-03819-2",
          sourceRecordUrl: "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2",
          title: "Highly accurate protein structure prediction with AlphaFold",
          url: "https://doi.org/10.1038/s41586-021-03819-2"
        }],
        summarySentences: [{
          evidenceIds: [],
          externalKnowledge: [sourceId],
          id: "external-fixture-sentence",
          status: "weak" as const,
          text: "这条论文外线索来自可追溯的主题检索。"
        }]
      },
      summary: "这条论文外线索来自可追溯的主题检索。",
      withinPaperClosure: false
    }
  };
}

const fixture = browserFixture || mindmapBrowserFixture || progressBrowserFixture
  ? createThinReadingFixture()
  : externalBrowserFixture
    ? createExternalThinReadingFixture()
    : null;

function ThinReadingBrowserFixture({
  deepMindMap,
  fixture,
  generationProgress
}: {
  deepMindMap?: boolean;
  fixture: CreateThinReadingDocumentInput;
  generationProgress?: { message: string; progress: number; stageLabel: string };
}) {
  const [document, setDocument] = React.useState(() => {
    let next = createThinReadingDocument(fixture);
    if (!deepMindMap) return next;
    const branchTitles = [
      "研究动机",
      "问题定义",
      "动作空间敏感度分析",
      "累计动作敏感度 `S_l(c)^{(b)}`",
      "两阶段高效敏感度估计"
    ];
    let parentNodeId = next.rootNodeId;
    branchTitles.forEach((title, index) => {
      next = advanceThinReadingDocument(next, {
        parentNodeId,
        seed: {
          ...fixture.rootSeed,
          summary: index === 3
            ? "使用 $S_l(c)^{(b)} = \\sum_i |\\Delta y_i|$ 比较不同层量化带来的累计误差。"
            : `${title}对应的知识原子，用于验证混合层次布局。`
        },
        source: { kind: "omitted_section", label: title, sectionKey: `browser-mindmap-${index}` },
        title
      });
      parentNodeId = next.activeNodeId;
    });
    return { ...next, activeNodeId: next.rootNodeId };
  });

  return (
    <ThinReadingTab
      artifactId={fixture.artifactId}
      document={document}
      generationProgress={generationProgress}
      onUpdateDocument={(_artifactId, nextDocument) => setDocument(nextDocument)}
      papers={[...fixture.papers]}
    />
  );
}

function OcrBrowserFixture() {
  const [result, setResult] = React.useState("正在识别扫描 PDF...");

  React.useEffect(() => {
    void extractPdfPages("/papers/liteasy-ocr-scanned-fixture.pdf", { ocrLanguage: "eng" })
      .then((pages) => setResult(pages.map((page) => page.text).join("\n")))
      .catch((error) => setResult(`OCR failed: ${error instanceof Error ? error.message : String(error)}`));
  }, []);

  return <main aria-label="OCR browser fixture" data-testid="ocr-browser-fixture">{result}</main>;
}

function ReaderEvidenceBrowserFixture() {
  const [zoom, setZoom] = React.useState(100);
  return (
    <main aria-label="PDF evidence browser fixture">
      <button aria-label="缩小 PDF 页面" onClick={() => setZoom((current) => Math.max(70, current - 10))} type="button">-</button>
      <span>显示比例 {zoom}%</span>
      <button aria-label="放大 PDF 页面" onClick={() => setZoom((current) => Math.min(180, current + 10))} type="button">+</button>
      <PdfReader
        selectedPapers={[{
          id: "browser-bert-evidence",
          sourcePath: "/papers/bert-pretraining-arxiv.pdf",
          title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
        }]}
        targetEvidence={{
          evidenceId: "browser-bert-bidirectional",
          page: 1,
          paperId: "browser-bert-evidence",
          quote: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.",
          requestId: 1
        }}
        zoom={zoom}
      />
    </main>
  );
}

function PaperResourceBrowserFixture() {
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="700" viewBox="0 0 1400 700"><rect width="1400" height="700" fill="#eef4f8"/><path d="M120 560L430 240L670 440L910 160L1280 540" fill="none" stroke="#0f6cbd" stroke-width="24"/><text x="700" y="650" text-anchor="middle" font-family="sans-serif" font-size="54" fill="#314653">MinerU architecture</text></svg>'
  )}`;
  const sourceMarkdown = [
    "# Space-efficient translation architecture",
    "English explanation ".repeat(360),
    "![Architecture diagram](images/architecture.svg)",
    "The figure remains attached to its source-owned section."
  ].join("\n\n");
  return (
    <PaperResourceTab
      figures={[{
        alt: "Architecture diagram",
        dataUrl,
        id: "browser-architecture",
        page: 1,
        sourcePath: "document/images/architecture.svg"
      }]}
      kind="multimodal"
      onTranslate={async (_source, _target, markedSource) => (
        markedSource
          .replace(/English explanation /g, "中文解释内容")
          .replace("![Architecture diagram](images/architecture.svg)", "")
      )}
      paper={{ id: "browser-paper", title: "Space-efficient translation layer" }}
      textChunks={[{
        page: 1,
        paperId: "browser-paper",
        paperTitle: "Space-efficient translation layer",
        snippet: "Flattened extraction",
        sourceMarkdown,
        summary: "",
        tags: [],
        textExtraction: "mineru"
      }]}
    />
  );
}

function PaperResourceFallbackBrowserFixture() {
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="1200" viewBox="0 0 6000 1200"><rect width="6000" height="1200" fill="#eef4f8"/><text x="3000" y="650" text-anchor="middle" font-family="sans-serif" font-size="180" fill="#314653">ACORN oversized source figure</text></svg>'
  )}`;
  const longToken = "predicate_agnostic_vector_search_".repeat(80);
  return (
    <PaperResourceTab
      figures={[{
        alt: "Oversized ACORN figure",
        dataUrl,
        id: "browser-acorn-oversized",
        page: 1,
        sourcePath: "images/acorn-oversized.svg"
      }]}
      kind="multimodal"
      paper={{ id: "browser-acorn", title: "ACORN fallback extraction" }}
      textChunks={[{
        page: 1,
        paperId: "browser-acorn",
        paperTitle: "ACORN fallback extraction",
        snippet: `# ACORN\n\nNormal readable prose before a deliberately long token.\n\n${longToken}\n\n<table><tr><th>Unbroken benchmark field</th></tr><tr><td>${longToken}</td></tr></table>`,
        summary: "",
        tags: [],
        textExtraction: "mineru"
      }]}
    />
  );
}

function GeneratedMindMapBrowserFixture() {
  const document: UIDslDocument = {
    actions: [],
    audit: {
      createdAt: "2026-08-03T00:00:00.000Z",
      generatedBy: "rule",
      traceId: "browser-generated-mindmap"
    },
    dataSources: [],
    id: "browser-generated-mindmap",
    intentPlanId: "browser-generated-mindmap",
    root: {
      component: "MindMap",
      id: "artifact-mindmap",
      props: {
        nodes: [
          { evidenceIds: ["evidence-root"], id: "qvla-root", kind: "root", label: "QVLA：面向 VLA 模型量化的论文思维导图" },
          { id: "qvla-section", kind: "section", label: "动作空间敏感度分析", parentId: "qvla-root" },
          { id: "qvla-formula", kind: "term", label: "累计动作敏感度 `S_(l,c)^(b)`", parentId: "qvla-section" },
          { id: "qvla-definition", kind: "term", label: "定义：一个 episode 内动作偏差之和的期望", parentId: "qvla-formula" }
        ],
        title: "Literature Mind Map"
      }
    },
    surface: "center_artifact",
    version: "liteasy-ui-dsl/v1"
  };
  return <DynamicCanvas document={document} onAction={() => undefined} />;
}

function ArtifactExportBrowserFixture() {
  return (
    <ArtifactTabs
      analysisHint=""
      canStartAnalysis
      onStartAnalysis={() => undefined}
      selectedCount={1}
      selectionLocked
      tabs={[{
        answer: "QVLA 使用动作空间敏感度指导逐通道位宽分配。",
        artifactId: "browser-export-qvla",
        outlineNodes: [
          { id: "root", kind: "root", label: "QVLA 思维导图" },
          { id: "formula", kind: "term", label: "累计动作敏感度 `S_(l,c)^(b)`", parentId: "root" }
        ],
        papers: [{ id: "qvla", title: "QVLA" }],
        title: "QVLA 导出测试",
        type: "mindmap"
      }]}
      tasks={[]}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme} className="fluent-app-root">
      {artifactExportBrowserFixture ? <ArtifactExportBrowserFixture /> : generatedMindmapBrowserFixture ? <GeneratedMindMapBrowserFixture /> : ocrBrowserFixture ? <OcrBrowserFixture /> : readerEvidenceBrowserFixture ? <ReaderEvidenceBrowserFixture /> : paperResourceFallbackBrowserFixture ? <PaperResourceFallbackBrowserFixture /> : paperResourceBrowserFixture ? <PaperResourceBrowserFixture /> : fixture ? (
        <ThinReadingBrowserFixture
          deepMindMap={mindmapBrowserFixture}
          fixture={fixture}
          generationProgress={progressBrowserFixture ? {
            message: "正在核验句级证据映射",
            progress: 64,
            stageLabel: "核验薄读证据"
          } : undefined}
        />
      ) : <App />}
    </FluentProvider>
  </React.StrictMode>,
);
