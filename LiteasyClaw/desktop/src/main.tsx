import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import App from "./App";
import { ThinReadingTab } from "./app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "./app/features/thin-reading/thinReadingFixtures";
import { createThinReadingDocument } from "./app/features/thin-reading/thinReadingProjection";
import type { CreateThinReadingDocumentInput } from "./app/features/thin-reading/thinReading.types";
import { extractPdfPages } from "./app/features/import/pdfTextExtractor";
import { PdfReader } from "./app/features/pdf/PdfReader";
import "./app/styles/app.css";

const browserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-fixture");
const externalBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-external-fixture");
const ocrBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-ocr-fixture");
const progressBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-progress-fixture");
const readerEvidenceBrowserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-reader-evidence-fixture");

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

const fixture = browserFixture || progressBrowserFixture
  ? createThinReadingFixture()
  : externalBrowserFixture
    ? createExternalThinReadingFixture()
    : null;

function ThinReadingBrowserFixture({
  fixture,
  generationProgress
}: {
  fixture: CreateThinReadingDocumentInput;
  generationProgress?: { message: string; progress: number; stageLabel: string };
}) {
  const [document, setDocument] = React.useState(() => createThinReadingDocument(fixture));

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme} className="fluent-app-root">
      {ocrBrowserFixture ? <OcrBrowserFixture /> : readerEvidenceBrowserFixture ? <ReaderEvidenceBrowserFixture /> : fixture ? (
        <ThinReadingBrowserFixture
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
