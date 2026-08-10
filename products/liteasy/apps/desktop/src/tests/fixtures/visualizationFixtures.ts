import type { VisualizationArtifactV1, SemanticObjectV1 } from "../../app/features/visualization/visualizationArtifact.types";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ThinReadingTab } from "../../app/features/thin-reading/ThinReadingTab";
import { propsWithVisualAndFigure, unauthorizedProps } from "./thinReadingVisualProps";
import type { DeepDiveTargetV1 } from "../../app/features/visualization/visualizationArtifact.types";
import type { ThinReadingBranchSource } from "../../app/features/thin-reading/thinReading.types";
import { createThinReadingAnchorGraphFixture, createThinReadingFixture } from "./thinReadingFixtures";
import { advanceThinReadingDocument, createThinReadingDocument } from "../../app/features/thin-reading/thinReadingProjection";
import { extractPdfPages } from "../../app/features/import/pdfTextExtractor";
import { PdfReader } from "../../app/features/pdf/PdfReader";
import ocrPdfUrl from "../assets/papers/liteasy-ocr-scanned-fixture.pdf?url";
import bertPdfUrl from "../assets/papers/bert-pretraining-arxiv.pdf?url";

export const artifactWithSelectedObject: VisualizationArtifactV1 = {
  artifactId: "viz-deep-dive",
  artifactVersion: "liteasy.visualization/v1",
  modality: "semantic_graph",
  nodeId: "node-1",
  locale: "zh-CN",
  spec: {
    modality: "semantic_graph",
    payload: {
      subtype: "flowchart",
      nodes: [{ id: "object-1", kind: "process", label: "Object", objectPath: ["object-1"], evidenceClaimIds: ["claim-1"] }],
      edges: [], groups: [], hierarchy: [], timeOrder: [],
      claims: [{ id: "claim-1", text: "Supported claim", evidenceIds: ["e-1"] }]
    }
  },
  implementation: { skillId: "fixture", skillVersion: "1", rendererId: "fixture", rendererVersion: "1" },
  evidenceBindings: [{ claimId: "claim-1", evidenceIds: ["e-1"], confidence: "direct" }],
  semanticObjects: [{ objectId: "object-1", kind: "process", label: "Object", objectPath: ["object-1"], evidenceClaimIds: ["claim-1"], selectable: true }],
  interaction: { pan: false, zoom: false, rotate: false, playback: "none", parameterIds: [], selectableObjectIds: ["object-1"] },
  accessibility: { summary: "Fixture", objectReadingOrder: ["object-1"] },
  validation: { outcome: "pass", checks: [], repairCount: 0 },
  fallbackHistory: [],
  usage: { ledgerId: "ledger", reservationId: "reservation", providerRouteId: "route", costPolicyVersion: "1", reservedUnits: 1, settledUnits: 1 },
  createdAt: "2026-08-10T00:00:00.000Z"
};
export const unknownObject: SemanticObjectV1 = {
  objectId: "unknown-object",
  kind: "process",
  label: "Unknown",
  objectPath: ["unknown-object"],
  evidenceClaimIds: ["claim-missing"],
  selectable: true
};

export function mountThinReadingBrowserFixture(
  container: HTMLElement | null,
  options: { deepMindMap?: boolean; external?: boolean; generationProgress?: boolean; anchorGraph?: boolean } = {}
) {
  if (!container) throw new Error("Thin-reading browser fixture container is missing.");
  const base = options.external
    ? (() => {
        const fixture = createThinReadingFixture();
        const sourceId = "crossref:10.1038/s41586-021-03819-2";
        return {
          ...fixture,
          rootSeed: {
            ...fixture.rootSeed,
            summary: "这条论文外线索来自可追溯的主题检索。",
            withinPaperClosure: false,
            evidence: {
              ...fixture.rootSeed.evidence,
              externalKnowledge: [sourceId],
              externalSources: [{
                abstract: "A verified Crossref topic result.", authors: ["J. Jumper"],
                id: sourceId, provider: "crossref" as const, relation: "topic_search" as const,
                relevance: 0.9, retrievalQuery: "protein structure prediction", sourceId: "10.1038/s41586-021-03819-2",
                sourceRecordUrl: "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2",
                title: "Highly accurate protein structure prediction with AlphaFold", url: "https://doi.org/10.1038/s41586-021-03819-2"
              }],
              summarySentences: [{ evidenceIds: [], externalKnowledge: [sourceId], id: "external-fixture-sentence", status: "weak" as const, text: "这条论文外线索来自可追溯的主题检索。" }]
            }
          }
        };
      })()
    : options.anchorGraph ? createThinReadingAnchorGraphFixture() : createThinReadingFixture();
  function createInitialDocument() {
    let document = createThinReadingDocument(base);
    if (!options.deepMindMap) return document;
    const branchTitles = ["研究动机", "问题定义", "动作空间敏感度分析", "累计动作敏感度 `S_l(c)^{(b)}`", "两阶段高效敏感度估计"];
    let parentNodeId = document.rootNodeId;
    branchTitles.forEach((title, index) => {
      document = advanceThinReadingDocument(document, {
        parentNodeId,
        seed: { ...base.rootSeed, summary: index === 3 ? "使用 $S_l(c)^{(b)} = \\sum_i |\\Delta y_i|$ 比较不同层量化带来的累计误差。" : `${title}对应的知识原子，用于验证混合层次布局。` },
        source: { kind: "omitted_section", label: title, sectionKey: `browser-mindmap-${index}` },
        title
      });
      parentNodeId = document.activeNodeId;
    });
    return { ...document, activeNodeId: document.rootNodeId };
  }
  function Fixture() {
    const [document, setDocument] = useState(createInitialDocument);
    return React.createElement(ThinReadingTab, {
      artifactId: base.artifactId,
      developerDiagnostics: options.generationProgress,
      document,
      generationProgress: options.generationProgress ? { message: "正在核验句级证据映射", progress: 64, stageLabel: "核验薄读证据" } : undefined,
      onUpdateDocument: (_artifactId: string, nextDocument: typeof document) => setDocument(nextDocument),
      papers: [...base.papers]
    });
  }
  createRoot(container).render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(Fixture)));
}

export function mountOcrBrowserFixture(container: HTMLElement | null) {
  if (!container) throw new Error("OCR browser fixture container is missing.");
  function Fixture() {
    const [result, setResult] = useState("正在识别扫描 PDF...");
    React.useEffect(() => {
      void extractPdfPages(ocrPdfUrl, { ocrLanguage: "eng" })
        .then((pages) => setResult(pages.map((page) => page.text).join("\n")))
        .catch((error) => setResult(`OCR failed: ${error instanceof Error ? error.message : String(error)}`));
    }, []);
    return React.createElement("main", { "aria-label": "OCR browser fixture", "data-testid": "ocr-browser-fixture" }, result);
  }
  createRoot(container).render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(Fixture)));
}

export function mountReaderEvidenceBrowserFixture(container: HTMLElement | null) {
  if (!container) throw new Error("PDF evidence fixture container is missing.");
  function Fixture() {
    const [zoom, setZoom] = useState(100);
    return React.createElement("main", { "aria-label": "PDF evidence browser fixture" },
      React.createElement("button", { "aria-label": "缩小 PDF 页面", onClick: () => setZoom((current) => Math.max(70, current - 10)), type: "button" }, "-"),
      React.createElement("span", null, `显示比例 ${zoom}%`),
      React.createElement("button", { "aria-label": "放大 PDF 页面", onClick: () => setZoom((current) => Math.min(180, current + 10)), type: "button" }, "+"),
      React.createElement(PdfReader, {
        selectedPapers: [{
          id: "browser-bert-evidence",
          sourcePath: new URL(bertPdfUrl, window.location.origin).href,
          title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
        }],
        targetEvidence: {
          evidenceId: "browser-bert-bidirectional", page: 1, paperId: "browser-bert-evidence",
          quote: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.", requestId: 1
        },
        zoom
      })
    );
  }
  createRoot(container).render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(Fixture)));
}

export function mountThinReadingMultimodalFixture(container: HTMLElement | null, authorized = true) {
  if (!container) throw new Error("Thin-reading multimodal fixture container is missing.");
  const initial = authorized ? propsWithVisualAndFigure : unauthorizedProps;
  const browserInitial = {
    ...initial,
    document: {
      ...initial.document,
      nodes: {
        ...initial.document.nodes,
        [initial.document.rootNodeId]: {
          ...initial.document.nodes[initial.document.rootNodeId],
          evidence: {
            ...initial.document.nodes[initial.document.rootNodeId].evidence,
            recommendedFigures: [
              { evidenceIds: ["evidence-attention-self-attention"], figureId: "figure-a", reason: "方法图解" },
              { evidenceIds: ["evidence-attention-self-attention"], figureId: "figure-b", reason: "结果核对" }
            ]
          },
          visualizations: initial.document.nodes[initial.document.rootNodeId].visualizations.map((artifact) => ({
            ...artifact,
            nodeId: initial.document.rootNodeId,
            evidenceBindings: [{ claimId: "thin-reading-claim-attention-core", confidence: "direct" as const, evidenceIds: ["evidence-attention-self-attention"] }],
            semanticObjects: [{ ...artifact.semanticObjects[0], evidenceClaimIds: ["thin-reading-claim-attention-core"] }],
            spec: artifact.spec.modality === "semantic_graph" ? {
              ...artifact.spec,
              payload: {
                ...artifact.spec.payload,
                claims: [{ id: "thin-reading-claim-attention-core", text: "Fixture claim", evidenceIds: ["evidence-attention-self-attention"] }]
              }
            } : artifact.spec
          }))
        }
      }
    },
    figures: initial.figures?.map((figure) => ({
      ...figure,
      id: figure.id === "figure-fixture" ? "figure-a" : figure.id,
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    })).concat(initial.figures?.map((figure) => ({
      ...figure,
      id: "figure-b",
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    })) ?? [])
  };
  function Fixture() {
    const [enabled, setEnabled] = useState(Boolean(browserInitial.visualizationCapability?.enabled));
    const capability = browserInitial.visualizationCapability
      ? { ...initial.visualizationCapability, enabled }
      : browserInitial.visualizationCapability;
    const onGenerateBranch = async ({ source }: { source: ThinReadingBranchSource }) => {
      const targets = ((window as unknown as { __liteasyThinReadingTargets?: DeepDiveTargetV1[] }).__liteasyThinReadingTargets ??= []);
      targets.push(source);
    };
    return React.createElement(
      FluentProvider,
      { theme: webLightTheme },
      React.createElement(ThinReadingTab, {
        ...browserInitial,
        onGenerateBranch,
        onToggleVisualization: setEnabled,
        visualizationCapability: capability
      })
    );
  }
  createRoot(container).render(React.createElement(Fixture));
}
