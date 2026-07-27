import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ThinReadingTab } from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import type { ThinReadingDocument } from "../app/features/thin-reading/thinReading.types";

function makeDocument(): ThinReadingDocument {
  return createThinReadingDocument(createThinReadingFixture());
}

function renderTab(document: ThinReadingDocument, onUpdateDocument = vi.fn()) {
  return render(
    <ThinReadingTab
      artifactId={document.artifactId}
      document={document}
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
    expect(screen.getByRole("button", { name: "实验" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
  });

  test("opens a branch menu for multiple generated children", () => {
    const root = makeDocument();
    const experiment = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      summary: "实验结果。",
      title: "实验"
    });
    const branched = advanceThinReadingDocument(experiment, {
      parentNodeId: root.rootNodeId,
      source: { kind: "omitted_section", label: "消融", sectionKey: "ablation" },
      summary: "消融结果。",
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

  test("shows a selection affordance and advances from selected text", () => {
    const document = makeDocument();
    const onUpdateDocument = vi.fn();
    renderTab(document, onUpdateDocument);
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

    expect(onUpdateDocument).toHaveBeenCalledWith(document.artifactId, expect.anything());
    const updatedDocument = onUpdateDocument.mock.calls[0][1] as ThinReadingDocument;
    expect(updatedDocument.nodes[updatedDocument.activeNodeId].source).toEqual({
      kind: "selected_text",
      excerpt: "被选中的摘要",
      prompt: "关注证据"
    });
  });
});
