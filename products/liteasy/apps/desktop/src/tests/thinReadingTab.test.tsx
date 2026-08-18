import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  resolveThinReadingSelectionPopoverPosition,
  splitThinReadingSummaryTextByAnchors,
  ThinReadingTab
} from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  advanceThinReadingDocument,
  createThinReadingDocument,
  setThinReadingAutoPublic
} from "../app/features/thin-reading/thinReadingProjection";
import type {
  ThinReadingDocument,
  ThinReadingNodeSeed,
  ThinReadingSupportMode
} from "../app/features/thin-reading/thinReading.types";
import type { ThinReadingCommunityRecommendationState } from "../app/features/thin-reading/useThinReadingCommunityRecommendations";
import { parseThinReadingDocument } from "../app/features/thin-reading/thinReadingVersioning";
import { v1Fixture } from "./fixtures/thinReadingVersionFixtures";
import { propsWithVisualAndFigure, unauthorizedProps } from "./fixtures/thinReadingVisualProps";
import { ThinReadingVisualizationRegion } from "../app/features/thin-reading/ThinReadingVisualizationRegion";

function makeDocument(): ThinReadingDocument {
  return createThinReadingDocument(createThinReadingFixture());
}

function makeSupportModeDocument(supportMode: ThinReadingSupportMode): ThinReadingDocument {
  const fixture = createThinReadingFixture();
  const externalSource = {
    abstract: "A traceable follow-up study.",
    authors: ["A. Author"],
    id: "openalex:W42",
    provider: "openalex",
    relation: "related" as const,
    relevance: 0.85,
    retrievalQuery: "follow-up",
    sourceId: "W42",
    sourceRecordUrl: "https://openalex.org/W42",
    title: "A Follow-up Study",
    url: "https://openalex.org/W42",
    year: 2025
  };
  if (supportMode === "paper") {
    return createThinReadingDocument({
      ...fixture,
      rootSeed: { ...fixture.rootSeed, supportMode }
    });
  }
  if (supportMode === "paper_and_external") {
    const text = "论文提出 self-attention，后续研究扩展了该方向。";
    return createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          externalKnowledge: [externalSource.id],
          externalSources: [externalSource],
          summarySentences: [{
            evidenceIds: ["evidence-attention-self-attention"],
            externalKnowledge: [externalSource.id],
            id: "sentence-paper-and-external",
            status: "weak",
            supportMode,
            text
          }]
        },
        summary: text,
        supportMode,
        withinPaperClosure: false
      }
    });
  }
  if (supportMode === "external_only") {
    const text = "后续研究从外部可追溯来源扩展了该方向。";
    return createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          claims: [],
          externalKnowledge: [externalSource.id],
          externalSources: [externalSource],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: [{
            evidenceIds: [],
            externalKnowledge: [externalSource.id],
            id: "sentence-external-only",
            status: "weak",
            supportMode,
            text
          }]
        },
        summary: text,
        supportMode,
        withinPaperClosure: false
      }
    });
  }
  const text = "在没有可信外部来源时，这里仅给出 AI 对跨论文问题的独立理解。";
  return createThinReadingDocument({
    ...fixture,
    rootSeed: {
      ...fixture.rootSeed,
      evidence: {
        anchors: [],
        claims: [],
        externalKnowledge: [],
        externalSources: [],
        generationAudit: {
          aiInterpretationReview: {
            reason: "正文没有冒充论文或外部来源结论。",
            unsafeSentenceIds: [],
            verdict: "pass"
          },
          externalFallback: {
            attemptedRoutes: ["support", "context", "challenge"],
            carriedSourceCount: 0,
            completedRoutes: ["support", "context", "challenge"],
            reason: "no_trusted_sources",
            trustedSourceCount: 0
          },
          model: { id: "fixture-model", provider: "fixture" },
          qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
          version: "liteasy.thin-reading-agent/v2"
        },
        paperEvidence: [],
        paperEvidenceSpans: [],
        summarySentences: [{
          evidenceIds: [],
          externalKnowledge: [],
          id: "sentence-ai-interpretation",
          status: "unsupported",
          supportMode,
          text
        }]
      },
      omittedSections: [],
      recommendations: [],
      summary: text,
      supportMode,
      withinPaperClosure: false
    }
  });
}

function renderTab(
  document: ThinReadingDocument,
  onUpdateDocument = vi.fn(),
  onOpenEvidence?: Parameters<typeof ThinReadingTab>[0]["onOpenEvidence"],
  onSyncIntuecho?: Parameters<typeof ThinReadingTab>[0]["onSyncIntuecho"],
  communityRecommendationState?: ThinReadingCommunityRecommendationState,
  onOpenVisualization?: Parameters<typeof ThinReadingTab>[0]["onOpenVisualization"],
  figures?: Parameters<typeof ThinReadingTab>[0]["figures"]
) {
  return render(
    <ThinReadingTab
      artifactId={document.artifactId}
      communityRecommendationState={communityRecommendationState}
      document={document}
      figures={figures}
      onOpenEvidence={onOpenEvidence}
      onOpenVisualization={onOpenVisualization}
      onSyncIntuecho={onSyncIntuecho}
      onUpdateDocument={onUpdateDocument}
      papers={createThinReadingFixture().papers}
    />
  );
}

function expandIntuecho() {
  const toggle = screen.queryByRole("button", { name: /^(展开|Expand) Intuecho/ });
  if (toggle) fireEvent.click(toggle);
}

function readyCommunityRecommendationState(): ThinReadingCommunityRecommendationState {
  return {
    recommendations: [{
      compatibility: 0.82,
      id: "community-recommendation-1",
      literatureId: "literature-attention",
      note: "社区成员讨论了 self-attention 对并行化的影响。",
      relationship: "方法与问题设定",
      source: "intuecho_community"
    }],
    status: "ready"
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThinReadingTab", () => {
  test("renders generated visuals before prose and source figures after prose", async () => {
    render(<ThinReadingTab {...propsWithVisualAndFigure} />);
    const order = within(screen.getByTestId("thin-reading-node"))
      .getAllByTestId(/thin-reading-(visuals|prose|source-figures)/)
      .map((element) => element.dataset.testid);
    expect(order).toEqual([
      "thin-reading-visuals", "thin-reading-prose", "thin-reading-source-figures"
    ]);
    await waitFor(() => expect(screen.getByTestId("visualization-artifact-stage")).toBeInTheDocument());
  });

  test("shows a disabled off switch without hiding source figures when unauthorized", () => {
    render(<ThinReadingTab {...unauthorizedProps} />);
    expect(screen.getByRole("switch", { name: "多模态" })).toBeDisabled();
    expect(screen.getByText("论文原图")).toBeVisible();
  });

  test("keeps an empty ready visualization stage stable", () => {
    render(
      <ThinReadingVisualizationRegion
        artifacts={[]}
        status={{ artifacts: [], status: "ready" }}
      />
    );
    expect(screen.getByTestId("thin-reading-visuals")).toHaveTextContent("未生成");
  });

  test("explains a rejected visualization result instead of calling it simplified", () => {
    render(
      <ThinReadingVisualizationRegion
        artifacts={[]}
        status={{ reasonCode: "result_invalid", status: "omitted" }}
      />
    );
    expect(screen.getByTestId("thin-reading-visuals")).toHaveTextContent("生成结果未通过校验");
    expect(screen.queryByText("已简化")).not.toBeInTheDocument();
  });

  test("hides the visualization stage when the current node does not need one", () => {
    const document = makeDocument();
    render(
      <ThinReadingTab
        {...propsWithVisualAndFigure}
        artifactId={document.artifactId}
        document={document}
        visualizationStatus={{ reasonCode: "intent_unavailable", status: "omitted" }}
      />
    );

    expect(screen.queryByTestId("thin-reading-visuals")).not.toBeInTheDocument();
    expect(screen.queryByText("已简化")).not.toBeInTheDocument();
    expect(screen.getByTestId("thin-reading-prose")).toBeVisible();
  });

  test("renders the persisted support mode as the only support class and localized label", () => {
    const cases = [
      ["paper", "论文内支持"],
      ["paper_and_external", "论文 + 外部支持"],
      ["external_only", "仅外部支持"],
      ["ai_interpretation", "AI 独立理解"]
    ] as const;

    for (const [supportMode, label] of cases) {
      const { container, unmount } = renderTab(makeSupportModeDocument(supportMode));
      const root = container.querySelector(".thin-reading");
      expect(screen.getByText(label, { selector: ".thin-reading__support-mode" })).toBeInTheDocument();
      expect([...root!.classList].filter((className) => className.startsWith("is-support-")))
        .toEqual([`is-support-${supportMode.replace(/_/gu, "-")}`]);
      unmount();
    }
  });

  test("discloses source-free AI interpretation and keeps its selected-text source ungrounded", async () => {
    const document = makeSupportModeDocument("ai_interpretation");
    const onGenerateBranch = vi.fn(async () => undefined);
    const { container } = render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );

    expect(container.querySelector(".thin-reading.is-support-ai-interpretation")).not.toBeNull();
    expect(screen.getByRole("note", { name: "无文献依据：AI 独立理解" })).toHaveTextContent(
      "本段必须超出论文范围，但外部检索未获得可信来源。以下正文没有论文内或外部文献依据，仅代表 AI 的独立理解，请勿视为论文结论或事实依据。"
    );
    expect(container.querySelector(".thin-reading__summary-marker")).toBeNull();
    expect(screen.queryByRole("link", { name: /打开外部来源/ })).not.toBeInTheDocument();

    const summary = screen.getByTestId("thin-reading-summary");
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "AI 对跨论文问题的独立理解",
      getRangeAt: () => ({
        commonAncestorContainer: summary,
        getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
      }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(summary);
    fireEvent.click(screen.getByRole("button", { name: "深入" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: {
        excerpt: "AI 对跨论文问题的独立理解",
        kind: "selected_text"
      }
    }));
    const source = onGenerateBranch.mock.calls[0]?.[0].source;
    expect(source).not.toHaveProperty("evidenceIds");
    expect(source).not.toHaveProperty("externalSourceIds");
  });

  test("keeps a desktop selection popover inside the visible viewport", () => {
    expect(resolveThinReadingSelectionPopoverPosition({
      bottom: 520,
      left: 1310,
      top: 490
    }, { height: 900, width: 1440 })).toEqual({
      left: 948,
      top: 530
    });

    expect(resolveThinReadingSelectionPopoverPosition({
      bottom: 820,
      left: 620,
      top: 790
    }, { height: 844, width: 1280 })).toEqual({
      bottom: 64,
      left: 620
    });
  });

  test("splits a thin-reading sentence at its persisted anchor span", () => {
    const sentence = {
      evidenceIds: ["evidence-1"],
      externalKnowledge: [],
      id: "sentence-1",
      status: "grounded" as const,
      text: "Late interaction preserves fine-grained matching."
    };
    const segments = splitThinReadingSummaryTextByAnchors({
      anchors: [{
        end: 16,
        evidenceIds: ["evidence-1"],
        externalSourceIds: ["openalex:W1"],
        id: "anchor-late-interaction",
        importance: 0.9,
        kind: "method",
        searchQuery: "late interaction retrieval",
        start: 0,
        summarySentenceId: "sentence-1",
        text: "Late interaction"
      }],
      sentence
    });

    expect(segments).toEqual([
      expect.objectContaining({ anchor: expect.objectContaining({ id: "anchor-late-interaction" }), text: "Late interaction" }),
      { text: " preserves fine-grained matching." }
    ]);
  });

  test("renders the root thin-reading surface and its navigation", () => {
    const document = makeDocument();

    const { container } = renderTab(document, vi.fn(), vi.fn());

    expect(screen.getByText("总述", { selector: ".is-active" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "论坛" })).toBeInTheDocument();
    expect(screen.getByText("连接 Intuecho 社区后显示共享批注推荐")).toBeInTheDocument();
    expect(screen.queryByText("本地阅读线索")).not.toBeInTheDocument();
    expect(screen.getByTestId("thin-reading-summary")).toHaveTextContent("self-attention");
    expect(screen.getByRole("button", { name: /打开证据句/ })).toHaveTextContent("证1");
    expect(screen.queryByText("依据")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /已由论文证据支撑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "实验" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "深入了解实验" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "深入了解局限" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
    expect(container.querySelectorAll("[data-testid='thin-reading-summary'] > p")).toHaveLength(1);
    expect(container.querySelector(".thin-reading__summary-unit")).toBeNull();
  });

  test("offers relationship-network and mind-map hierarchy views without a top Graph View button", () => {
    const root = makeDocument();
    const document = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: [] },
        omittedSections: [],
        recommendations: [],
        summary: "实验结果。",
        withinPaperClosure: true
      },
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });
    const rootActive = { ...document, activeNodeId: document.rootNodeId };
    const onUpdateDocument = vi.fn();

    const { container } = renderTab(rootActive, onUpdateDocument);
    expect(screen.queryByText("Graph View")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关系网络" }));

    expect(screen.getByLabelText("薄读页面关系图")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "薄读页面网络" })).toBeInTheDocument();
    expect(screen.getByLabelText("选择要聚焦的薄读层级")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "思维导图" }));
    expect(screen.getByRole("heading", { name: "薄读层次思维导图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "思维导图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("完整思维导图")).toBeInTheDocument();
    expect(screen.getByText("前两级向右展开，第三级起在父节点下方单列排列")).toBeInTheDocument();
    expect(container.querySelector(".thin-reading__mindmap-node")).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("完整思维导图")).getByRole("button", { exact: true, name: "实验" }));
    expect(onUpdateDocument).toHaveBeenCalledWith(rootActive.artifactId, {
      ...rootActive,
      activeNodeId: document.activeNodeId
    });
    fireEvent.click(screen.getByRole("button", { name: "收起结构图" }));
    expect(screen.queryByLabelText("薄读页面关系图")).not.toBeInTheDocument();
    expect(screen.getByLabelText("选择薄读结构图形式")).toBeInTheDocument();
  });

  test("uses a declared omitted-module button as the complete branch topic", async () => {
    const document = makeDocument();
    const onGenerateBranch = vi.fn(async () => undefined);
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "深入了解实验" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" }
    }));
  });

  test("labels recovered branch submission as a new model request", async () => {
    const retry = vi.fn(async () => undefined);
    const document = makeDocument();
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onRetryInterruptedBranch={retry}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );

    expect(screen.getByText(
      "将使用已核验的同一输入创建新的模型请求，不会续跑已中断的调用。"
    )).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新提交同一输入" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  test("localizes interrupted branch recovery for English artifacts", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      targetLanguage: "en-US"
    });

    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onRetryInterruptedBranch={vi.fn()}
        onUpdateDocument={vi.fn()}
        papers={fixture.papers}
      />
    );

    expect(screen.getByRole("button", { name: "Resubmit the same input" })).toBeInTheDocument();
    expect(screen.getByText(
      "This creates a new model request from the same verified input; it does not resume the interrupted call."
    )).toBeInTheDocument();
    expect(screen.queryByText("重新提交同一输入")).not.toBeInTheDocument();
  });

  test("does not infer a source boundary from topology depth", () => {
    const fixture = createThinReadingFixture();
    const root = createThinReadingDocument(fixture);
    const document = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: fixture.rootSeed,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });
    const secondLevel = advanceThinReadingDocument(document, {
      parentNodeId: document.activeNodeId,
      seed: fixture.rootSeed,
      source: { kind: "omitted_section", label: "消融", sectionKey: "ablation" },
      title: "消融"
    });

    const { container } = renderTab(secondLevel);

    expect(screen.getByText("论文内支持")).toBeInTheDocument();
    expect(screen.queryByText("目标论文仅能部分回答")).not.toBeInTheDocument();
    expect(container.querySelector(".thin-reading__article-meta")).not.toBeInTheDocument();
    expect(screen.queryByText("目标论文无法回答当前问题")).not.toBeInTheDocument();
  });

  test("shows the partial-answer boundary for the paper-and-external tier", () => {
    renderTab(makeSupportModeDocument("paper_and_external"));

    expect(screen.getByText("论文 + 外部支持")).toBeInTheDocument();
    expect(screen.getByText("目标论文仅能部分回答")).toBeInTheDocument();
    expect(screen.getByText(
      "目标论文证据可回答当前问题的实质部分；完整回答还需要论文外的可追溯来源。"
    )).toBeInTheDocument();
    expect(screen.queryByText("目标论文无法回答当前问题")).not.toBeInTheDocument();
  });

  test("opens PDF evidence only from summary markers", () => {
    const document = makeDocument();
    const onUpdateDocument = vi.fn();
    const onOpenEvidence = vi.fn();
    renderTab(document, onUpdateDocument, onOpenEvidence);

    fireEvent.click(screen.getByTestId("thin-reading-summary"));
    expect(onOpenEvidence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /打开证据句/ }));

    expect(onOpenEvidence).toHaveBeenCalledWith({
      evidenceId: "evidence-attention-self-attention",
      page: 2,
      paperId: "paper-attention",
      quote: "Self-attention replaces recurrence in the encoder."
    });
    expect(onUpdateDocument).not.toHaveBeenCalled();
  });

  test("renders and opens every evidence span attached to the same sentence", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          paperEvidence: ["evidence-attention-self-attention", "evidence-attention-parallel"],
          paperEvidenceSpans: [
            ...(fixture.rootSeed.evidence.paperEvidenceSpans ?? []),
            {
              chunkId: "paper-attention:p3:chunk-2",
              confidence: 0.88,
              id: "evidence-attention-parallel",
              page: 3,
              paperId: "paper-attention",
              quote: "The model allows for significantly more parallelization."
            }
          ],
          summarySentences: [{
            evidenceIds: ["evidence-attention-self-attention", "evidence-attention-parallel"],
            externalKnowledge: [],
            id: "sentence-multiple-evidence",
            status: "grounded",
            text: "Transformer replaces recurrence and increases parallelization."
          }]
        }
      }
    });
    const onOpenEvidence = vi.fn();

    renderTab(document, vi.fn(), onOpenEvidence);

    expect(screen.getByRole("button", { name: /打开证据句 1/ })).toHaveTextContent("证1");
    const secondMarker = screen.getByRole("button", { name: /打开证据句 2/ });
    expect(secondMarker).toHaveTextContent("证2");
    fireEvent.click(secondMarker);

    expect(onOpenEvidence).toHaveBeenCalledWith({
      evidenceId: "evidence-attention-parallel",
      page: 3,
      paperId: "paper-attention",
      quote: "The model allows for significantly more parallelization."
    });
  });

  test("renders paper and external markers together when a sentence has both boundaries", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          externalKnowledge: ["openalex:W42"],
          externalSources: [{
            abstract: "A follow-up study.",
            authors: ["A. Author"],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.85,
            retrievalQuery: "follow-up",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "A Follow-up Study",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          summarySentences: [{
            evidenceIds: ["evidence-attention-self-attention"],
            externalKnowledge: ["openalex:W42"],
            id: "sentence-mixed-boundaries",
            status: "weak",
            text: "论文提出 self-attention，后续研究扩展了该方向。"
          }]
        }
      }
    });

    renderTab(document, vi.fn(), vi.fn());

    expect(screen.getByRole("button", { name: /打开证据句 1/ })).toHaveTextContent("证1");
    expect(screen.getByRole("link", { name: "打开外部来源：A Follow-up Study" })).toHaveTextContent("外1");
  });

  test("opens a Crossref source directly from its compact sentence marker", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        summary: "这条论文外线索来自可追溯的主题检索。",
        supportMode: "external_only",
        withinPaperClosure: false,
        evidence: {
          ...fixture.rootSeed.evidence,
          claims: [],
          externalKnowledge: ["crossref:10.1038/s41586-021-03819-2"],
          externalSources: [{
            abstract: "A Crossref source.",
            authors: ["J. Jumper"],
            doi: "https://doi.org/10.1038/s41586-021-03819-2",
            id: "crossref:10.1038/s41586-021-03819-2",
            provider: "crossref",
            relation: "topic_search",
            relevance: 0.8,
            retrievalQuery: "protein structure prediction",
            sourceId: "10.1038/s41586-021-03819-2",
            sourceRecordUrl: "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2",
            title: "Highly accurate protein structure prediction with AlphaFold",
            url: "https://doi.org/10.1038/s41586-021-03819-2"
          }],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: [{
            evidenceIds: [],
            externalKnowledge: ["crossref:10.1038/s41586-021-03819-2"],
            id: "crossref-sentence",
            status: "weak",
            text: "这条论文外线索来自可追溯的主题检索。"
          }]
        }
      }
    });

    renderTab(document);

    expect(screen.getByRole("link", { name: "打开外部来源：Highly accurate protein structure prediction with AlphaFold" }))
      .toHaveAttribute("href", "https://doi.org/10.1038/s41586-021-03819-2");
  });

  test("forwards persisted page-text offsets when opening evidence", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          paperEvidenceSpans: fixture.rootSeed.evidence.paperEvidenceSpans?.map((span) => ({
            ...span,
            pageTextEnd: 92,
            pageTextStart: 38
          }))
        }
      }
    });
    const onOpenEvidence = vi.fn();

    renderTab(document, vi.fn(), onOpenEvidence);
    fireEvent.click(screen.getByRole("button", { name: /打开证据句/ }));

    expect(onOpenEvidence).toHaveBeenCalledWith(expect.objectContaining({
      pageTextEnd: 92,
      pageTextStart: 38
    }));
  });

  test("renders all thin-reading interface copy in the document target language", async () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        omittedSections: [{ id: "section-method", label: "Method", sectionKey: "method" }],
        recommendations: [{
          compatibility: 0.9,
          id: "recommendation-method",
          note: "A local recommendation lead about the method.",
          relationship: "Method and evidence"
        }],
        summary: "The paper replaces recurrence with self-attention.",
        evidence: {
          ...fixture.rootSeed.evidence,
          summarySentences: [{
            evidenceIds: ["evidence-attention-self-attention"],
            externalKnowledge: [],
            id: "sentence-method",
            status: "grounded",
            text: "The paper replaces recurrence with self-attention."
          }]
        }
      },
      targetLanguage: "en-US"
    });
    const onGenerateBranch = vi.fn(async () => undefined);

    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        generationProgress={{
          message: "Internal generation stage",
          partialAnswer: "Unreviewed streamed prose",
          progress: 42,
          stageLabel: "Evidence review"
        }}
        onGenerateBranch={onGenerateBranch}
        onOpenEvidence={vi.fn()}
        onUpdateDocument={vi.fn()}
        papers={fixture.papers}
      />
    );

    expect(screen.getByLabelText("Thin reading page")).toBeInTheDocument();
    expect(screen.getByText("Overview", { selector: ".is-active" })).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText(/Local identity only/)).toBeInTheDocument();
    expect(globalThis.document.querySelector(".thin-reading__article-meta")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open evidence 1 for/ })).toHaveTextContent("E1");
    expandIntuecho();
    expect(screen.getByRole("button", { name: "Collapse Intuecho recommendations" })).toBeInTheDocument();
    expect(screen.getByText("Connect Intuecho to view community shared annotations")).toBeInTheDocument();
    expect(screen.getByText("No annotations yet")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Generating the thin-reading text. It will appear on this page when ready."
    );
    expect(screen.queryByText("Internal generation stage")).not.toBeInTheDocument();
    expect(screen.queryByText("Unreviewed streamed prose")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore Method" })).toBeInTheDocument();
    expect(screen.queryByText("暂无批注")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Explore Intuecho recommendation: Method and evidence" })).not.toBeInTheDocument();
    expect(onGenerateBranch).not.toHaveBeenCalled();
  });

  test("collapses and restores the Intuecho recommendation rail", () => {
    const document = makeDocument();
    renderTab(document, vi.fn(), undefined, undefined, readyCommunityRecommendationState());
    expandIntuecho();

    fireEvent.click(screen.getByRole("button", { name: "收起 Intuecho 推荐栏" }));

    expect(screen.queryByRole("heading", { name: "论坛" })).not.toBeInTheDocument();
    const floatingTrigger = screen.getByRole("button", { name: "展开 Intuecho 推荐栏" });
    expect(floatingTrigger).toHaveClass("thin-reading__intuecho-floating");
    expect(floatingTrigger.closest("aside")).toBeNull();

    fireEvent.click(floatingTrigger);

    expect(screen.getByRole("heading", { name: "论坛" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起 Intuecho 推荐栏" })).toBeInTheDocument();
  });

  test("shows an empty state only after a connected community request returns no results", () => {
    const document = makeDocument();
    renderTab(document, vi.fn(), undefined, undefined, { recommendations: [], status: "ready" });
    expandIntuecho();

    expect(screen.getByRole("heading", { name: "论坛" })).toBeInTheDocument();
    expect(screen.getByText("暂无社区推荐")).toBeInTheDocument();
  });

  test("keeps the community rail visible when the current paper cannot be matched", () => {
    const document = makeDocument();
    renderTab(document, vi.fn(), undefined, undefined, { recommendations: [], status: "unavailable" });
    expandIntuecho();

    expect(screen.getByRole("heading", { name: "论坛" })).toBeInTheDocument();
    expect(screen.getByText("当前文献仅有本地身份，无法匹配社区共享批注")).toBeInTheDocument();
  });

  test("shows loading and failure states for a configured community source", () => {
    const document = makeDocument();
    const { rerender } = render(
      <ThinReadingTab
        artifactId={document.artifactId}
        communityRecommendationState={{ recommendations: [], status: "loading" }}
        document={document}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );

    expandIntuecho();

    expect(screen.getByRole("status")).toHaveTextContent("正在加载社区推荐");

    rerender(
      <ThinReadingTab
        artifactId={document.artifactId}
        communityRecommendationState={{ message: "HTTP 503", recommendations: [], status: "error" }}
        document={document}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("加载社区推荐失败：HTTP 503");
  });

  test("opens a branch menu for multiple generated children", () => {
    const root = makeDocument();
    const experiment = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-exp"] },
        omittedSections: [],
        recommendations: [],
        summary: "实验结果。",
        withinPaperClosure: true
      },
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });
    const branched = advanceThinReadingDocument(experiment, {
      parentNodeId: root.rootNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-ablation"] },
        omittedSections: [],
        recommendations: [],
        summary: "消融结果。",
        withinPaperClosure: true
      },
      source: { kind: "omitted_section", label: "消融", sectionKey: "ablation" },
      title: "消融"
    });
    const rootActive = { ...branched, activeNodeId: branched.rootNodeId };

    renderTab(rootActive);

    const nextButton = screen.getByRole("button", { name: "查看已生成的下一层页面" });
    fireEvent.focus(nextButton);

    const menu = screen.getByRole("menu", { name: "已生成的下一层页面" });
    expect(within(menu).getByRole("menuitem", { name: /实验/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /消融/ })).toBeInTheDocument();
    expect(within(menu).getAllByText(/遗漏板块/)).toHaveLength(2);
  });

  test("shows the complete ancestor path and returns directly to an intermediate node", () => {
    const root = makeDocument();
    const experiment = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-experiment"] },
        omittedSections: [],
        recommendations: [],
        summary: "实验结果。",
        withinPaperClosure: true
      },
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });
    const ablation = advanceThinReadingDocument(experiment, {
      parentNodeId: experiment.activeNodeId,
      seed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-ablation"] },
        omittedSections: [],
        recommendations: [],
        summary: "消融结果。",
        withinPaperClosure: true
      },
      source: { kind: "omitted_section", label: "消融", sectionKey: "ablation" },
      title: "消融"
    });
    const onUpdateDocument = vi.fn();

    renderTab(ablation, onUpdateDocument);

    const breadcrumbs = screen.getByLabelText("薄读层级");
    expect(within(breadcrumbs).getByRole("button", { name: "总述" })).toBeInTheDocument();
    const experimentBreadcrumb = within(breadcrumbs).getByRole("button", { name: "实验" });
    expect(within(breadcrumbs).getByText("消融")).toHaveAttribute("aria-current", "page");

    fireEvent.click(experimentBreadcrumb);

    expect(onUpdateDocument).toHaveBeenCalledWith(
      ablation.artifactId,
      expect.objectContaining({ activeNodeId: experiment.activeNodeId })
    );
  });

  test("keeps legacy v1 navigation read-only", async () => {
    const childId = "thin-reading-child-v1";
    const root = v1Fixture.nodes[v1Fixture.rootNodeId];
    const document = parseThinReadingDocument({
      ...v1Fixture,
      activeNodeId: childId,
      nodes: {
        [v1Fixture.rootNodeId]: { ...root, childIds: [childId] },
        [childId]: {
          ...root,
          childIds: [],
          depth: 1,
          id: childId,
          parentId: v1Fixture.rootNodeId,
          recommendationScope: { kind: "section", paperId: "paper-1", sectionKey: "results" },
          source: { kind: "omitted_section", label: "Results", sectionKey: "results" },
          title: "Results"
        }
      }
    });
    const onUpdateDocument = vi.fn();
    const onGenerateBranch = vi.fn(async () => undefined);

    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={onUpdateDocument}
        papers={createThinReadingFixture().papers}
      />
    );
    fireEvent.click(within(screen.getByLabelText("Thin reading depth"))
      .getByRole("button", { name: "Overview" }));

    expect(within(screen.getByLabelText("Thin reading depth")).getByText("Overview"))
      .toHaveAttribute("aria-current", "page");
    expect(onUpdateDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Explore Methods" }));
    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: document.artifactId,
      document: expect.objectContaining({ activeNodeId: document.rootNodeId }),
      source: { kind: "omitted_section", label: "Methods", sectionKey: "methods" }
    })));
  });

  test("shows a selection affordance and requests Agent branch generation from selected text", async () => {
    const document = makeDocument();
    const onUpdateDocument = vi.fn();
    const onGenerateBranch = vi.fn(async () => undefined);
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={onUpdateDocument}
        papers={createThinReadingFixture().papers}
      />
    );
    const paragraph = screen.getByTestId("thin-reading-summary");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "被选中的摘要",
      getRangeAt: () =>
        ({
          commonAncestorContainer: paragraph,
          getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
        }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(paragraph);

    expect(screen.getByRole("button", { name: "深入" })).toBeInTheDocument();
    const deepenPrompt = screen.getByRole("textbox", { name: "深入提示（可选）" });
    expect(deepenPrompt).toHaveAttribute("maxlength", "600");
    fireEvent.change(deepenPrompt, {
      target: { value: "关注证据" }
    });
    fireEvent.click(screen.getByRole("button", { name: "深入" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: {
        evidenceIds: ["evidence-attention-self-attention"],
        kind: "selected_text",
        excerpt: "被选中的摘要",
        prompt: "关注证据"
      }
    }));
  });

  test("launches a quick command with structured output requirements from selected text", async () => {
    const document = makeDocument();
    const onGenerateBranch = vi.fn(async () => undefined);
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );
    const paragraph = screen.getByTestId("thin-reading-summary");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "被选中的摘要",
      getRangeAt: () =>
        ({
          commonAncestorContainer: paragraph,
          getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
        }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(paragraph);

    const quickCommands = screen.getByLabelText("快捷命令列表");
    expect(within(quickCommands).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["生成流程可视化", "生成结构可视化", "生成过程可视化"]);
    expect(within(quickCommands).queryByText(/HTML|mermaid/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "深入提示（可选）" }), {
      target: { value: "强调并行化收益" }
    });
    fireEvent.click(screen.getByRole("button", { name: "生成流程可视化" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: {
        evidenceIds: ["evidence-attention-self-attention"],
        excerpt: "被选中的摘要",
        kind: "selected_text",
        prompt: "请生成受控的流程可视化：只使用论文证据支持的步骤和关系，并配 2-3 句简短说明。\n\n用户补充：强调并行化收益",
        quickCommand: "visualize_flow",
        requestedOutput: "visualization_intent"
      }
    }));
  });

  test("closes the selection menu immediately and locks duplicate generation while the model is running", async () => {
    const document = makeDocument();
    let finishGeneration!: () => void;
    const onGenerateBranch = vi.fn(() => new Promise<void>((resolve) => {
      finishGeneration = resolve;
    }));
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );
    const paragraph = screen.getByTestId("thin-reading-summary");
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "被选中的摘要",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
      }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(paragraph);

    const command = screen.getByRole("button", { name: "生成流程可视化" });
    fireEvent.click(command);
    fireEvent.click(command);

    expect(screen.queryByLabelText("快捷命令列表")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在生成薄读正文，完成后将在当前页面显示。");
    expect(screen.queryByLabelText("LLM 实时工作窗口")).not.toBeInTheDocument();
    expect(screen.queryByText(/请求已提交.*请勿重复点击/)).not.toBeInTheDocument();
    expect(onGenerateBranch).toHaveBeenCalledTimes(1);

    finishGeneration();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  test("does not offer selection deepening for a generation error", () => {
    const document = makeDocument();
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
        taskFailureMessage="生成本层内容失败"
      />
    );
    const error = screen.getByText("生成本层内容失败");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "生成本层内容失败",
      getRangeAt: () => ({
        commonAncestorContainer: error,
        getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
      }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(error);

    expect(screen.queryByLabelText("深入提示（可选）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "深入" })).not.toBeInTheDocument();
  });

  test("automatically sends a newly saved public annotation while retaining its retry queue", async () => {
    const document = setThinReadingAutoPublic(makeDocument(), true);
    const onUpdateDocument = vi.fn();
    const onSyncIntuecho = vi.fn(async () => undefined);
    renderTab(document, onUpdateDocument, undefined, onSyncIntuecho);
    const paragraph = screen.getByTestId("thin-reading-summary");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "被选中的摘要",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
      }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(paragraph);
    fireEvent.change(screen.getByRole("textbox", { name: "批注" }), {
      target: { value: "自动公开的选区批注" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存批注" }));

    const updatedDocument = onUpdateDocument.mock.calls[0][1] as ThinReadingDocument;
    expect(updatedDocument.annotations[0]).toMatchObject({
      body: "自动公开的选区批注",
      visibility: "pending_public"
    });
    expect(updatedDocument.pendingPublicAnnotationIds).toEqual([updatedDocument.annotations[0].id]);
    await waitFor(() => expect(onSyncIntuecho).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document: updatedDocument
    }));
  });

  test("does not offer selection deepening for a community recommendation", () => {
    const document = makeDocument();
    const communityRecommendationState = readyCommunityRecommendationState();
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        communityRecommendationState={communityRecommendationState}
        document={document}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );
    expandIntuecho();
    const recommendationNote = screen.getByText("社区成员讨论了 self-attention 对并行化的影响。");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "self-attention 对并行化",
      getRangeAt: () =>
        ({
          commonAncestorContainer: recommendationNote,
          getBoundingClientRect: () => ({ bottom: 188, left: 420, right: 620, top: 160 })
        }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(recommendationNote);

    expect(screen.queryByLabelText("深入提示（可选）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "深入" })).not.toBeInTheDocument();
  });

  test("preserves an external source target when saving a selected external reading lead", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          claims: [],
          externalKnowledge: ["openalex:W42"],
          externalSources: [{
            abstract: "A follow-up study.",
            authors: ["A. Author"],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.85,
            retrievalQuery: "follow-up",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "A Follow-up Study",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: [{
            evidenceIds: [],
            externalKnowledge: ["openalex:W42"],
            id: "sentence-external",
            status: "weak",
            text: "后续研究扩展了这套方法。"
          }]
        },
        summary: "后续研究扩展了这套方法。",
        withinPaperClosure: false
      }
    });
    const onUpdateDocument = vi.fn();
    renderTab(document, onUpdateDocument);
    const sourceLink = screen.getByRole("link", { name: "打开外部来源：A Follow-up Study" });

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "外1",
      getRangeAt: () => ({
        commonAncestorContainer: sourceLink,
        getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
      }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(sourceLink);

    fireEvent.change(screen.getByRole("textbox", { name: "批注" }), {
      target: { value: "外部来源待核验" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存批注" }));

    const updatedDocument = onUpdateDocument.mock.calls[0][1] as ThinReadingDocument;
    expect(updatedDocument.annotations[0].target).toEqual({
      kind: "external_knowledge",
      nodeId: document.activeNodeId,
      source: "openalex:W42"
    });
  });

  test("allows external reading leads to be annotated but not deepened", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          claims: [],
          externalKnowledge: ["openalex:W42"],
          externalSources: [{
            abstract: "A follow-up study.",
            authors: ["A. Author"],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.85,
            retrievalQuery: "follow-up",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "A Follow-up Study",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: [{
            evidenceIds: [],
            externalKnowledge: ["openalex:W42"],
            id: "sentence-external",
            status: "weak",
            text: "后续研究扩展了这套方法。"
          }]
        },
        summary: "后续研究扩展了这套方法。",
        withinPaperClosure: false
      }
    });
    const onGenerateBranch = vi.fn(async () => undefined);
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={vi.fn()}
        papers={fixture.papers}
      />
    );
    const sourceLink = screen.getByRole("link", { name: "打开外部来源：A Follow-up Study" });
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "外1",
      getRangeAt: () => ({
        commonAncestorContainer: sourceLink,
        getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
      }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(sourceLink);
    expect(screen.getByRole("textbox", { name: "批注" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "深入" })).not.toBeInTheDocument();
    expect(onGenerateBranch).not.toHaveBeenCalled();
  });

  test("does not expose a direct deepening action for an Intuecho recommendation", () => {
    const document = makeDocument();
    const onGenerateBranch = vi.fn(async () => undefined);
    render(
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onGenerateBranch={onGenerateBranch}
        onUpdateDocument={vi.fn()}
        papers={createThinReadingFixture().papers}
      />
    );

    expect(screen.queryByRole("button", { name: "深入 Intuecho 推荐：方法与问题设定" })).not.toBeInTheDocument();
    expect(onGenerateBranch).not.toHaveBeenCalled();
  });

  test("prefers agent-recommended MinerU figures and shows the recommendation reason", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          recommendedFigures: [
            {
              evidenceIds: ["evidence-attention-self-attention"],
              figureId: "figure-b",
              reason: "先看整体信息流。"
            },
            {
              evidenceIds: ["evidence-attention-self-attention"],
              figureId: "figure-a",
              reason: "再看 token 间对齐细节。"
            }
          ]
        }
      }
    });
    const figures = [
      {
        alt: "Figure A",
        dataUrl: "data:image/png;base64,aaa",
        id: "figure-a",
        page: 2,
        sourcePath: "/tmp/figure-a.png",
        analysis: {
          description: "局部细节。",
          importance: "primary" as const,
          kind: "architecture" as const,
          placement: "method" as const,
          selectionReason: "旧启发式理由 A",
          title: "结构细节图"
        }
      },
      {
        alt: "Figure B",
        dataUrl: "data:image/png;base64,bbb",
        id: "figure-b",
        page: 2,
        sourcePath: "/tmp/figure-b.png",
        analysis: {
          description: "整体流程。",
          importance: "supporting" as const,
          kind: "workflow" as const,
          placement: "overview" as const,
          selectionReason: "旧启发式理由 B",
          title: "整体流程图"
        }
      }
    ];

    const { container } = renderTab(document, vi.fn(), undefined, undefined, undefined, undefined, figures);

    expect(container.querySelectorAll(".thin-reading__figure-embed h4")[0]).toHaveTextContent("整体流程图");
    expect(container.querySelectorAll(".thin-reading__figure-embed h4")[1]).toHaveTextContent("结构细节图");
    expect(container.querySelector(".thin-reading__source-figures .thin-reading__figure-embed")).not.toBeNull();
    expect(container.querySelector(".thin-reading__visual-evidence")).toBeNull();
    expect(screen.getByText("建议先看：先看整体信息流。")).toBeInTheDocument();
    expect(screen.getByText("建议先看：再看 token 间对齐细节。")).toBeInTheDocument();
  });

  test("renders a read-only v1 HTML demo and forwards it to the visualization tab", () => {
    const onOpenVisualization = vi.fn();
    const document = parseThinReadingDocument(v1Fixture);

    renderTab(document, vi.fn(), undefined, undefined, undefined, onOpenVisualization);

    expect(screen.getByLabelText("HTML Demo：Legacy demo")).toBeInTheDocument();
    expect(screen.getByTitle("Legacy demo")).toHaveAttribute("srcdoc", expect.stringContaining("<svg"));

    fireEvent.click(screen.getByRole("button", { name: "在独立标签页打开 HTML Demo：Legacy demo" }));

    expect(onOpenVisualization).toHaveBeenCalledWith({
      description: "Legacy executable content.",
      html: expect.stringContaining("<svg"),
      id: `html-demo:${document.artifactId}:${document.activeNodeId}`,
      kind: "html_demo",
      title: "Legacy demo"
    });
  });

  test("does not render executable legacy evidence from new v2 documents", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          interactiveDemo: {
            description: "V2 must drop this HTML demo.",
            html: "<section>demo</section>",
            kind: "html",
            title: "Dropped v2 demo"
          },
          mermaid: "flowchart LR\nA-->B"
        }
      }
    });

    renderTab(document, vi.fn());

    expect(screen.queryByLabelText("HTML Demo：Dropped v2 demo")).not.toBeInTheDocument();
    expect(screen.queryByText("关系与流程")).not.toBeInTheDocument();
  });

  test("saves pending-public annotations locally", () => {
    const document = makeDocument();
    const onUpdateDocument = vi.fn();
    renderTab(document, onUpdateDocument);
    const paragraph = screen.getByTestId("thin-reading-summary");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "self-attention",
      getRangeAt: () =>
        ({
          commonAncestorContainer: paragraph,
          getBoundingClientRect: () => ({ bottom: 120, left: 80, right: 180, top: 100 })
        }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(paragraph);

    fireEvent.change(screen.getByRole("textbox", { name: "批注" }), {
      target: { value: "这句很关键" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "公开" }));
    fireEvent.click(screen.getByRole("button", { name: "保存批注" }));

    const updatedDocument = onUpdateDocument.mock.calls[0][1] as ThinReadingDocument;
    expect(updatedDocument.annotations[0]).toMatchObject({
      body: "这句很关键",
      excerpt: "self-attention",
      visibility: "pending_public"
    });
    expect(updatedDocument.pendingPublicAnnotationIds).toEqual([updatedDocument.annotations[0].id]);
  });

  test("hands pending public annotations to the configured Intuecho sync action", async () => {
    const root = makeDocument();
    const document = addThinReadingAnnotation(root, {
      body: "等待远端确认的批注。",
      excerpt: "self-attention",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const onSyncIntuecho = vi.fn(async () => undefined);
    renderTab(document, vi.fn(), undefined, onSyncIntuecho);
    expandIntuecho();

    const syncButton = screen.getByRole("button", { name: "同步公开批注" });
    expect(syncButton).toBeEnabled();
    fireEvent.click(syncButton);

    await waitFor(() => expect(onSyncIntuecho).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document
    }));
  });

  test("does not add a pending-review marker to legacy unsupported summary sentences", () => {
    const fixture = createThinReadingFixture();
    const unsupportedSeed: ThinReadingNodeSeed = {
      ...fixture.rootSeed,
      evidence: {
        ...fixture.rootSeed.evidence,
        claims: [
          {
            evidenceIds: [],
            id: "claim-unsupported",
            status: "unsupported",
            text: "模型声称论文证明了一个没有证据的结论。"
          }
        ],
        paperEvidence: [],
        paperEvidenceSpans: [],
        summarySentences: [
          {
            evidenceIds: [],
            externalKnowledge: [],
            id: "sentence-unsupported",
            status: "unsupported",
            text: "模型声称论文证明了一个没有证据的结论。"
          }
        ]
      }
    };
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: unsupportedSeed
    });

    renderTab(document);

    expect(screen.queryByText("依据")).not.toBeInTheDocument();
    expect(screen.queryByText("待核")).not.toBeInTheDocument();
    expect(globalThis.document.querySelector(".thin-reading__summary-sentence--unsupported")).toBeNull();
  });

  test("does not add a pending-review marker to legacy summaries without sentence mappings", () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          ...fixture.rootSeed.evidence,
          summarySentences: []
        },
        summary: "第一句来自旧产物。第二句也没有独立来源映射。"
      }
    });
    const onOpenEvidence = vi.fn();

    renderTab(document, vi.fn(), onOpenEvidence);

    expect(screen.queryByText("待核")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开证据句/ })).not.toBeInTheDocument();
    expect(onOpenEvidence).not.toHaveBeenCalled();
  });

  test("renders traceable external sources as compact superscript links", () => {
    const fixture = createThinReadingFixture();
    const text = "后续研究扩展了这套方法。";
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: {
        ...fixture.rootSeed,
        evidence: {
          claims: [],
          externalKnowledge: ["openalex:W42"],
          externalSources: [{
            abstract: "A follow-up study.",
            authors: ["A. Author"],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.85,
            retrievalQuery: "follow-up",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "A Follow-up Study",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          paperEvidence: [],
          paperEvidenceSpans: [],
          summarySentences: [{
            evidenceIds: [],
            externalKnowledge: ["openalex:W42"],
            id: "sentence-external",
            status: "weak",
            text
          }]
        },
        summary: text,
        withinPaperClosure: false
      }
    });

    renderTab(document);

    const marker = screen.getByRole("link", { name: "打开外部来源：A Follow-up Study" });
    expect(marker).toHaveTextContent("外1");
    expect(marker).toHaveAttribute("href", "https://openalex.org/W42");
    expect(marker.getAttribute("title")).toContain("相关工作");
    expect(marker.closest("sup")).not.toBeNull();
    expect(screen.queryByLabelText("目标论文无法回答当前问题")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本轮外部来源")).not.toBeInTheDocument();
  });
});
