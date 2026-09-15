import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  formatPaperAnchorText,
  paperAnchorEntitySchema,
  paperAnchorFromEvidence,
  paperAnchorFromObject,
  paperAnchorOpenRequest,
  paperAnchorsFromCitations,
  paperCitationOpenRequest,
} from "../app/features/paper-anchors/paperAnchorEntity";
import { PaperAnchorReferences } from "../app/features/paper-anchors/PaperAnchorReferences";
import { AssistantMarkdown } from "../app/features/assistant/AssistantMarkdown";
import { prepareMultiPaperAnalysis } from "../app/features/paper-analysis/multiPaperAnalysisWorkflow";
import { DynamicCanvas } from "../app/features/generative-ui/DynamicCanvas";

const evidence = {
  id: "evidence-opaque_abc-123",
  paperId: "paper-internal-123",
  paperTitle: "Attention Paper",
  page: 3,
  pageTextStart: 12,
  pageTextEnd: 35,
  textExtraction: "mineru" as const,
  quote: "Attention connects tokens.",
  analysisRunId: "analysis-abc",
  chunkId: "chunk-3",
};

describe("paper anchor entities", () => {
  test("generation persists source identity, locator and display snapshot with citations", () => {
    const prepared = prepareMultiPaperAnalysis({
      selectedPapers: [{ id: evidence.paperId, title: evidence.paperTitle }],
      importedChunksByPaperId: { [evidence.paperId]: [{
        paperId: evidence.paperId, paperTitle: evidence.paperTitle, page: evidence.page,
        pageTextStart: evidence.pageTextStart, pageTextEnd: evidence.pageTextEnd,
        textExtraction: evidence.textExtraction, snippet: evidence.quote,
        summary: "Token connections", tags: ["attention"],
      }] },
      query: "attention",
    });
    const reloaded = JSON.parse(JSON.stringify(prepared));
    const source = reloaded.evidence[0];
    const entity = paperAnchorEntitySchema.parse(source.paperAnchor);
    expect(entity.presentation).toEqual({
      kind: "paper-citation", placement: "after-content", title: "Attention Paper", location: "第 3 页",
    });
    expect(entity.provenance.sourceRecordId).toBe(source.id);
    expect(reloaded.citations[0].paperAnchor).toEqual(entity);
    expect(paperAnchorFromEvidence({ ...source, paperTitle: "Renamed paper" }).presentation.title).toBe("Attention Paper");
    expect(paperCitationOpenRequest(reloaded.citations[0])).toMatchObject({
      evidenceId: source.id, paperId: evidence.paperId, page: 3, pageTextStart: 12, pageTextEnd: 35, textExtraction: "mineru",
    });
  });

  test("retains object revisions and the complete PDF selector without inventing source references", () => {
    const selector = {
      type: "pdf" as const,
      sourceRef: { objectId: "object-paper", revision: "revision-1" },
      documentHash: "original-document-hash", page: 3, displayPage: "iii",
      quote: { exact: "Source text", prefix: "before ", suffix: " after" },
      range: { start: 7, end: 18 }, rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.1 }],
      extractor: "embedded", normalization: "v1", precision: "exact" as const,
    };
    const entity = paperAnchorEntitySchema.parse(paperAnchorFromObject({
      id: "saved-fragment", paperId: "paper-1", paperTitle: "Source", anchor: selector,
    }));
    expect(entity.source.selector).toEqual(selector);
    expect(entity.source.objectRef).toEqual(selector.sourceRef);
    expect(entity.presentation.location).toBe("第 iii 页");
    expect(paperAnchorFromEvidence(evidence).source.objectRef).toBeUndefined();
  });

  test("resolves opaque markers exactly and leaves missing or ambiguous bindings explicit", () => {
    const anchor = paperAnchorFromEvidence(evidence);
    expect(formatPaperAnchorText(`A [${evidence.id}], B evidence-unknown.`, [anchor]))
      .toBe("A 〔Attention Paper · 第 3 页〕, B 〔来源待关联〕.");
    const conflict = paperAnchorFromEvidence({ ...evidence, paperId: "different-paper" });
    expect(formatPaperAnchorText(`[${evidence.id}]`, [anchor, conflict])).toBe("〔来源待关联〕");
    const citations = paperAnchorsFromCitations([{ paperId: "old-paper", page: 5, snippet: "Legacy quote" }], [], "message-1");
    expect(citations[0].evidenceIds).toEqual([]);
    expect(formatPaperAnchorText("[evidence-old-paper-0]", citations)).toBe("〔来源待关联〕");
    expect(citations[0].provenance.sourceRecordId).toBe("message-1:citation:0");
  });

  test("rejects inconsistent persisted entity bindings and cannot open a missing page", () => {
    const anchor = paperAnchorFromEvidence(evidence);
    const mismatched = paperAnchorFromEvidence({ ...evidence, paperAnchor: {
      ...anchor, source: { paperId: "wrong-paper" },
    } });
    expect(mismatched.source.paperId).toBe(evidence.paperId);
    expect(paperAnchorEntitySchema.safeParse({
      ...anchor, locator: { ...anchor.locator, pageTextEnd: 1 },
    }).success).toBe(false);
    const unavailable = paperAnchorFromEvidence({ ...evidence, page: undefined });
    expect(paperAnchorOpenRequest(unavailable)).toBeUndefined();
    const onOpen = vi.fn();
    render(<PaperAnchorReferences anchors={[unavailable]} onOpen={onOpen} />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("来源位置未记录，保留原文摘录。")).toBeInTheDocument();
    expect(screen.getByText(evidence.quote)).toBeInTheDocument();
  });

  test("renders readable prose and fixed source cards while keeping code and source navigation intact", () => {
    const anchor = paperAnchorFromEvidence(evidence);
    const onOpen = vi.fn();
    const { container } = render(<>
      <AssistantMarkdown value={`A claim [${evidence.id}] and [evidence-unknown].\n\n\`evidence-code-example\``} paperAnchors={[anchor]} />
      <PaperAnchorReferences anchors={[anchor]} onOpen={onOpen} />
    </>);
    expect(screen.getByText(/A claim 〔Attention Paper · 第 3 页〕 and 〔来源待关联〕/)).toBeInTheDocument();
    expect(container.textContent).not.toContain(evidence.id);
    expect(screen.getByText("evidence-code-example").tagName).toBe("CODE");
    expect(screen.getByText(evidence.quote)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开原文证据 1：Attention Paper 第 3 页" }));
    expect(onOpen).toHaveBeenCalledWith(anchor);
    expect(paperAnchorOpenRequest(onOpen.mock.calls[0][0])).toEqual({
      evidenceId: evidence.id, paperId: evidence.paperId, page: 3,
      pageTextStart: 12, pageTextEnd: 35, textExtraction: "mineru", quote: evidence.quote,
    });
  });

  test("renders only the first twelve source cards until more are requested", () => {
    const anchors = Array.from({ length: 40 }, (_, index) => paperAnchorFromEvidence({
      ...evidence, id: `evidence-${index}`, page: index + 1,
    }));
    render(<PaperAnchorReferences anchors={anchors} onOpen={vi.fn()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "显示更多引用（剩余 28 条）" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(24);
  });

  test("routes a slide's persisted reference through the canvas to its original paper anchor", () => {
    const anchor = paperAnchorFromEvidence(evidence);
    const onOpen = vi.fn();
    render(<DynamicCanvas onAction={vi.fn()} onOpenPaperAnchor={onOpen} paperAnchors={[anchor]} document={{
      version: "liteasy-ui-dsl/v1", id: "deck", intentPlanId: "plan", surface: "center_artifact",
      actions: [], dataSources: [], audit: { createdAt: "2026-09-15T00:00:00Z", generatedBy: "agent", traceId: "run" },
      root: { component: "SlideDeck", id: "slides", props: {
        title: "Findings", slides: [{ id: "slide-1", title: "Attention", markdown: `Claim [${evidence.id}].`, evidenceIds: [evidence.id] }],
      } },
    }} />);
    expect(screen.getByText("本页引用原文")).toBeInTheDocument();
    expect(screen.getByText("Claim 〔Attention Paper · 第 3 页〕.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开原文证据 1：Attention Paper 第 3 页" }));
    expect(onOpen).toHaveBeenCalledWith(anchor);
  });
});
