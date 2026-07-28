import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ThinReadingTab } from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import type { ThinReadingNodeSeed } from "../app/features/thin-reading/thinReading.types";
import type { ThinReadingDocument } from "../app/features/thin-reading/thinReading.types";

function makeDocument(): ThinReadingDocument {
  return createThinReadingDocument(createThinReadingFixture());
}

function renderTab(
  document: ThinReadingDocument,
  onUpdateDocument = vi.fn(),
  onOpenEvidence?: Parameters<typeof ThinReadingTab>[0]["onOpenEvidence"]
) {
  return render(
    <ThinReadingTab
      artifactId={document.artifactId}
      document={document}
      onOpenEvidence={onOpenEvidence}
      onUpdateDocument={onUpdateDocument}
      papers={createThinReadingFixture().papers}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThinReadingTab", () => {
  test("renders the root thin-reading surface and its navigation", () => {
    const document = makeDocument();

    renderTab(document, vi.fn(), vi.fn());

    expect(screen.getByText("总述")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
    expect(screen.getByTestId("thin-reading-summary")).toHaveTextContent("self-attention");
    expect(screen.getByRole("button", { name: /打开证据句/ })).toHaveTextContent("证1");
    expect(screen.queryByText("依据")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /已由论文证据支撑/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "实验" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
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
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText(/Local identity only/)).toBeInTheDocument();
    expect(globalThis.document.querySelector(".thin-reading__article-meta")).toHaveTextContent("Paper evidence");
    expect(screen.getByRole("button", { name: /Open evidence 1 for/ })).toHaveTextContent("E1");
    expect(screen.getByRole("button", { name: "Collapse Intuecho recommendations" })).toBeInTheDocument();
    expect(screen.getByText("No annotations yet")).toBeInTheDocument();
    expect(screen.queryByText("暂无批注")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Explore Intuecho recommendation: Method and evidence" }));
    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        kind: "selected_text",
        excerpt: "A local recommendation lead about the method.",
        prompt: "Explore this local Intuecho recommendation lead: Method and evidence"
      }
    })));
  });

  test("collapses and restores the Intuecho recommendation rail", () => {
    const document = makeDocument();
    renderTab(document);

    fireEvent.click(screen.getByRole("button", { name: "收起 Intuecho 推荐栏" }));

    expect(screen.queryByRole("heading", { name: "Intuecho" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 Intuecho 推荐栏" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Intuecho 推荐栏" }));

    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起 Intuecho 推荐栏" })).toBeInTheDocument();
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
    fireEvent.change(screen.getByRole("textbox", { name: "深入提示（可选）" }), {
      target: { value: "关注证据" }
    });
    fireEvent.click(screen.getByRole("button", { name: "深入" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: {
        kind: "selected_text",
        excerpt: "被选中的摘要",
        prompt: "关注证据"
      }
    }));
  });

  test("lets Intuecho recommendation text enter the same selection deepen flow", async () => {
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
    const recommendationNote = screen.getByText("本地待同步的理解线索，关注 self-attention 如何替代 recurrence。");

    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "self-attention 如何替代 recurrence",
      getRangeAt: () =>
        ({
          commonAncestorContainer: recommendationNote,
          getBoundingClientRect: () => ({ bottom: 188, left: 420, right: 620, top: 160 })
        }) as Range
    } as unknown as Selection);
    fireEvent.mouseUp(recommendationNote);

    fireEvent.click(screen.getByRole("button", { name: "深入" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: {
        kind: "selected_text",
        excerpt: "self-attention 如何替代 recurrence"
      }
    }));
  });

  test("can deepen an Intuecho recommendation directly without pretending it is synced community data", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "深入 Intuecho 推荐：方法与问题设定" }));

    await waitFor(() => expect(onGenerateBranch).toHaveBeenCalledWith({
      artifactId: document.artifactId,
      document,
      source: {
        kind: "selected_text",
        excerpt: "本地待同步的理解线索，关注 self-attention 如何替代 recurrence。",
        prompt: "围绕 Intuecho 本地推荐线索继续深入：方法与问题设定"
      }
    }));
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

  test("marks unsupported summary sentences without highlighting the body text", () => {
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
    expect(screen.getByText("待核")).toHaveClass("thin-reading__summary-marker", "is-static");
    expect(globalThis.document.querySelector(".thin-reading__summary-sentence--unsupported")).toBeNull();
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
  });
});
