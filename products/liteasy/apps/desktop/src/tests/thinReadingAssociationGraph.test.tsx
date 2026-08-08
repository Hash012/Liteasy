import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ThinReadingTab } from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingAnchorGraphFixture } from "./fixtures/thinReadingFixtures";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";

/*
 * jsdom lays nothing out, and this view is *about* where laid-out text ended up. The rectangles
 * are therefore stubbed — one per anchor, at a place of this test's choosing — so the wiring from
 * a measured mark to a drawn node can still be checked here. Whether the real geometry reads well
 * is a browser question, and is covered by the Playwright case on the same fixture.
 */
const containerRect = { bottom: 600, height: 600, left: 0, right: 1100, top: 0, width: 1100, x: 0, y: 0 };
const anchorOrder = new Map<string, number>();

beforeEach(() => {
  anchorOrder.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { ...containerRect, toJSON: () => containerRect } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const anchorId = this.dataset?.anchorId;
    if (!anchorId) return [] as unknown as DOMRectList;
    if (!anchorOrder.has(anchorId)) anchorOrder.set(anchorId, anchorOrder.size);
    const index = anchorOrder.get(anchorId)!;
    const rect = { height: 22, left: 120 + index * 90, top: 140 + index * 44, width: 110 };
    return [{ ...rect, bottom: rect.top + rect.height, right: rect.left + rect.width, x: rect.left, y: rect.top }] as unknown as DOMRectList;
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1100 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderArtifact(options: { strictMode?: boolean } = {}) {
  const fixture = createThinReadingAnchorGraphFixture();
  const tab = (
    <ThinReadingTab
      artifactId={fixture.artifactId}
      document={createThinReadingDocument(fixture)}
      onUpdateDocument={vi.fn()}
      papers={[...fixture.papers]}
    />
  );
  return render(options.strictMode ? <StrictMode>{tab}</StrictMode> : tab);
}

test("cycles one related-recommendations button through article, marks, graph, and article", () => {
  const { container } = renderArtifact();
  const button = screen.getByRole("button", { name: "相关推荐" });

  expect(screen.queryByRole("button", { name: "概念标记" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "页级关联图" })).not.toBeInTheDocument();
  expect(button).toHaveAttribute("aria-pressed", "false");
  expect(button).toHaveAttribute("title", "显示概念标记");
  expect(container.querySelector(".thin-reading__body")).toHaveClass("is-marks-hidden");
  const hiddenAnchor = container.querySelector<HTMLElement>(".thin-reading__anchor");
  expect(hiddenAnchor).toHaveClass("is-hidden");
  expect(hiddenAnchor).not.toHaveAttribute("aria-hidden");
  expect(hiddenAnchor).not.toHaveAttribute("role");
  expect(hiddenAnchor).toHaveAttribute("tabindex", "-1");
  expect(screen.getByTestId("thin-reading-summary")).toHaveTextContent("self-attention");
  fireEvent.click(hiddenAnchor!);
  expect(container.querySelector(".association-layer")).toBeNull();

  fireEvent.click(button);
  expect(screen.getByText("概念标记")).toBeVisible();
  expect(button).toHaveAttribute("aria-pressed", "true");
  expect(button).toHaveAttribute("title", "打开页级关联图");
  expect(container.querySelector(".thin-reading__anchor")).not.toHaveClass("is-hidden");
  expect(screen.getByRole("button", { name: '查看“self-attention”关联论文' })).toHaveAttribute("tabindex", "0");

  fireEvent.click(button);

  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(container.querySelectorAll(".association-anchor__chip")).toHaveLength(5);
  // Ten distinct papers, one of them reached from two anchors: ten nodes and eleven edges.
  expect(container.querySelectorAll(".association-node")).toHaveLength(10);
  expect(container.querySelectorAll(".association-edge")).toHaveLength(11);
  expect(container.querySelectorAll(".association-node.is-crossing")).toHaveLength(1);
  expect(screen.getByText("2 个锚点交叉")).toBeVisible();
  expect(button).toHaveAttribute("title", "返回正文");

  fireEvent.click(button);
  expect(container.querySelector(".association-layer")).toBeNull();
  expect(container.querySelector(".thin-reading__body")).toHaveClass("is-marks-hidden");
  expect(button).toHaveAttribute("aria-pressed", "false");
});

test("a concept in the prose opens the graph focused on itself", () => {
  const { container } = renderArtifact();

  fireEvent.click(screen.getByRole("button", { name: "相关推荐" }));
  fireEvent.click(screen.getByRole("button", { name: '查看“self-attention”关联论文' }));

  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(screen.getByText("聚焦概念")).toBeVisible();
  expect(screen.getByText("正在聚焦「self-attention」及其关联文献")).toBeVisible();
  // The other four anchors stay on the page, quietened rather than removed.
  expect(container.querySelectorAll(".association-anchor.is-dimmed")).toHaveLength(4);
});

test("Enter and Space open a keyboard-reachable concept directly in its focused graph", () => {
  const { container } = renderArtifact();
  const recommendations = screen.getByRole("button", { name: "相关推荐" });
  fireEvent.click(recommendations);
  let anchor = screen.getByRole("button", { name: '查看“self-attention”关联论文' });
  anchor.focus();

  fireEvent.keyDown(anchor, { key: "Enter" });
  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(screen.getByText("聚焦概念")).toBeVisible();
  expect(screen.getByRole("button", { name: '查看“self-attention”关联论文' })).toHaveAttribute("tabindex", "0");

  fireEvent.keyDown(window, { key: "Escape" });
  anchor = screen.getByRole("button", { name: '查看“self-attention”关联论文' });
  anchor.focus();
  fireEvent.keyDown(anchor, { key: " " });
  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(screen.getByText("正在聚焦「self-attention」及其关联文献")).toBeVisible();
});

test("the graph replaces the inline source list rather than adding a second copy of it", () => {
  const { container } = renderArtifact();

  const button = screen.getByRole("button", { name: "相关推荐" });
  fireEvent.click(button);
  fireEvent.click(button);

  expect(container.querySelector(".thin-reading__anchor-sources")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /核心方法的原始定义与理论依据/u }));
  expect(container.querySelector(".association-reading-card")).not.toBeNull();
  expect(screen.getByText(/正在阅读「核心方法的原始定义与理论依据」/u)).toBeVisible();
});

test("Escape returns one layer at a time and restores focus in StrictMode", () => {
  const { container } = renderArtifact({ strictMode: true });
  const button = screen.getByRole("button", { name: "相关推荐" });

  fireEvent.click(button);
  fireEvent.click(button);
  const paperNode = screen.getByRole("button", { name: /核心方法的原始定义与理论依据/u });
  act(() => paperNode.focus());
  fireEvent.click(paperNode);
  expect(container.querySelector(".association-reading-card")).not.toBeNull();
  expect(screen.getByRole("button", { name: "返回关联图" })).toHaveFocus();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".association-reading-card")).toBeNull();
  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(paperNode).toHaveFocus();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".association-layer")).toBeNull();
  expect(container.querySelector(".thin-reading__body.is-graph-dimmed")).toBeNull();
  expect(screen.getByText("概念标记已显示")).toBeVisible();
  expect(button).toHaveFocus();

  const anchor = screen.getByRole("button", { name: '查看“self-attention”关联论文' });
  act(() => anchor.focus());
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".thin-reading__body")).toHaveClass("is-marks-hidden");
  expect(screen.getByText("相关推荐未展开")).toBeVisible();
  expect(button).toHaveFocus();
});

test("changing the active thin-reading node resets related recommendations to article", () => {
  const fixture = createThinReadingAnchorGraphFixture();
  const root = createThinReadingDocument(fixture);
  const withChild = advanceThinReadingDocument(root, {
    parentNodeId: root.rootNodeId,
    seed: fixture.rootSeed,
    source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
    title: "实验"
  });
  const rootActive = { ...withChild, activeNodeId: withChild.rootNodeId };
  const { container, rerender } = render(
    <ThinReadingTab
      artifactId={rootActive.artifactId}
      document={rootActive}
      onUpdateDocument={vi.fn()}
      papers={[...fixture.papers]}
    />
  );
  const button = screen.getByRole("button", { name: "相关推荐" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(container.querySelector(".association-layer")).not.toBeNull();

  rerender(
    <ThinReadingTab
      artifactId={withChild.artifactId}
      document={withChild}
      onUpdateDocument={vi.fn()}
      papers={[...fixture.papers]}
    />
  );

  expect(container.querySelector(".association-layer")).toBeNull();
  expect(screen.getByRole("button", { name: "相关推荐" })).toHaveAttribute("aria-pressed", "false");
  expect(container.querySelector(".thin-reading__body")).toHaveClass("is-marks-hidden");
});
