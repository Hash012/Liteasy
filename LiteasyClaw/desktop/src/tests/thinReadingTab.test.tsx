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

    renderTab(document);

    expect(screen.getByText("总述")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Intuecho" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /已由论文证据支撑/ })).toHaveTextContent(
      "Transformer 用 self-attention 替代 recurrence"
    );
    expect(screen.getByRole("button", {
      name: "打开论文内证据 evidence-attention-self-attention 第 2 页"
    })).toHaveTextContent(
      "Self-attention replaces recurrence"
    );
    expect(screen.getByRole("button", { name: "实验" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
  });

  test("opens PDF evidence spans and keeps annotation as a separate action", () => {
    const document = makeDocument();
    const onUpdateDocument = vi.fn();
    const onOpenEvidence = vi.fn();
    renderTab(document, onUpdateDocument, onOpenEvidence);

    fireEvent.click(screen.getByRole("button", {
      name: "打开论文内证据 evidence-attention-self-attention 第 2 页"
    }));

    expect(onOpenEvidence).toHaveBeenCalledWith({
      evidenceId: "evidence-attention-self-attention",
      page: 2,
      paperId: "paper-attention",
      quote: "Self-attention replaces recurrence in the encoder."
    });
    expect(onUpdateDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: "批注论文内证据 evidence-attention-self-attention"
    }));

    const updatedDocument = onUpdateDocument.mock.calls[0][1] as ThinReadingDocument;
    expect(updatedDocument.annotations[0]).toMatchObject({
      excerpt: "Self-attention replaces recurrence in the encoder.",
      target: expect.objectContaining({
        evidence: "evidence-attention-self-attention",
        kind: "paper_evidence"
      })
    });
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

  test("adds annotations to structured claims", () => {
    const document = makeDocument();
    const onUpdateDocument = vi.fn();
    renderTab(document, onUpdateDocument);

    fireEvent.click(screen.getByRole("button", { name: /已由论文证据支撑/ }));

    const updatedDocument = onUpdateDocument.mock.calls[0][1] as ThinReadingDocument;
    expect(updatedDocument.annotations[0]).toMatchObject({
      excerpt: expect.stringContaining("self-attention"),
      target: expect.objectContaining({
        claimId: "thin-reading-claim-attention-core",
        kind: "claim"
      })
    });
  });

  test("marks unsupported claims for review instead of rendering them as ordinary text", () => {
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
        ]
      }
    };
    const document = createThinReadingDocument({
      ...fixture,
      rootSeed: unsupportedSeed
    });

    renderTab(document);

    expect(screen.getByText("未支撑，待复核")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /未支撑，待复核/ })).toHaveClass(
      "thin-reading__claim--unsupported"
    );
  });
});
