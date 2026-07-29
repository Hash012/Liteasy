import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  resolveThinReadingSelectionPopoverPosition,
  ThinReadingTab
} from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  advanceThinReadingDocument,
  createThinReadingDocument,
  setThinReadingAutoPublic
} from "../app/features/thin-reading/thinReadingProjection";
import type { ThinReadingNodeSeed } from "../app/features/thin-reading/thinReading.types";
import type { ThinReadingDocument } from "../app/features/thin-reading/thinReading.types";
import type { ThinReadingCommunityRecommendationState } from "../app/features/thin-reading/useThinReadingCommunityRecommendations";

function makeDocument(): ThinReadingDocument {
  return createThinReadingDocument(createThinReadingFixture());
}

function renderTab(
  document: ThinReadingDocument,
  onUpdateDocument = vi.fn(),
  onOpenEvidence?: Parameters<typeof ThinReadingTab>[0]["onOpenEvidence"],
  onSyncIntuecho?: Parameters<typeof ThinReadingTab>[0]["onSyncIntuecho"],
  communityRecommendationState?: ThinReadingCommunityRecommendationState
) {
  return render(
    <ThinReadingTab
      artifactId={document.artifactId}
      communityRecommendationState={communityRecommendationState}
      document={document}
      onOpenEvidence={onOpenEvidence}
      onSyncIntuecho={onSyncIntuecho}
      onUpdateDocument={onUpdateDocument}
      papers={createThinReadingFixture().papers}
    />
  );
}

function readyCommunityRecommendationState(): ThinReadingCommunityRecommendationState {
  return {
    recommendations: [{
      compatibility: 0.82,
      id: "community-recommendation-1",
      note: "社区成员讨论了 self-attention 对并行化的影响。",
      paperIdentity: {
        id: "doi:10.48550/arxiv.1706.03762",
        kind: "doi",
        source: "metadata",
        value: "10.48550/arxiv.1706.03762"
      },
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

  test("renders the root thin-reading surface and its navigation", () => {
    const document = makeDocument();

    renderTab(document, vi.fn(), vi.fn());

    expect(screen.getByText("总述", { selector: ".is-active" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
    expect(screen.getByText("连接 Intuecho 社区后显示共享批注推荐")).toBeInTheDocument();
    expect(screen.queryByText("本地阅读线索")).not.toBeInTheDocument();
    expect(screen.getByTestId("thin-reading-summary")).toHaveTextContent("self-attention");
    expect(screen.getByRole("button", { name: /打开证据句/ })).toHaveTextContent("证1");
    expect(screen.queryByText("依据")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /已由论文证据支撑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "实验" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
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

    expect(screen.getByText("将创建新的模型请求，不会续跑已中断的调用。")).toBeInTheDocument();
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
    expect(screen.getByText("This creates a new model request; it does not resume the interrupted call.")).toBeInTheDocument();
    expect(screen.queryByText("重新提交同一输入")).not.toBeInTheDocument();
  });

  test("warns before the closure boundary without mislabelling paper evidence as external", () => {
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

    expect(screen.getByText("接近论文原文闭包")).toBeInTheDocument();
    expect(container.querySelector(".thin-reading__article-meta")).not.toBeInTheDocument();
    expect(screen.queryByText("已越出论文原文闭包")).not.toBeInTheDocument();
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
        withinPaperClosure: false,
        evidence: {
          ...fixture.rootSeed.evidence,
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
    expect(screen.getByRole("button", { name: "Collapse Intuecho recommendations" })).toBeInTheDocument();
    expect(screen.getByText("Connect Intuecho to view community shared annotations")).toBeInTheDocument();
    expect(screen.getByText("No annotations yet")).toBeInTheDocument();
    expect(screen.queryByText("暂无批注")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Explore Intuecho recommendation: Method and evidence" })).not.toBeInTheDocument();
    expect(onGenerateBranch).not.toHaveBeenCalled();
  });

  test("collapses and restores the Intuecho recommendation rail", () => {
    const document = makeDocument();
    renderTab(document, vi.fn(), undefined, undefined, readyCommunityRecommendationState());

    fireEvent.click(screen.getByRole("button", { name: "收起 Intuecho 推荐栏" }));

    expect(screen.queryByRole("heading", { name: "Intuecho" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 Intuecho 推荐栏" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Intuecho 推荐栏" }));

    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起 Intuecho 推荐栏" })).toBeInTheDocument();
  });

  test("shows an empty state only after a connected community request returns no results", () => {
    const document = makeDocument();
    renderTab(document, vi.fn(), undefined, undefined, { recommendations: [], status: "ready" });

    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
    expect(screen.getByText("暂无社区推荐")).toBeInTheDocument();
  });

  test("keeps the community rail visible when the current paper cannot be matched", () => {
    const document = makeDocument();
    renderTab(document, vi.fn(), undefined, undefined, { recommendations: [], status: "unavailable" });

    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
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

  test("honors automatic publication when saving an annotation from selected text", () => {
    const document = setThinReadingAutoPublic(makeDocument(), true);
    const onUpdateDocument = vi.fn();
    renderTab(document, onUpdateDocument);
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
    expect(screen.queryByLabelText("已越出论文原文闭包")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本轮外部来源")).not.toBeInTheDocument();
  });
});
