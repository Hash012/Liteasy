import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ThinReadingTab } from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingAnchorGraphFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";

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

function renderArtifact() {
  const fixture = createThinReadingAnchorGraphFixture();
  return render(
    <ThinReadingTab
      artifactId={fixture.artifactId}
      document={createThinReadingDocument(fixture)}
      onUpdateDocument={vi.fn()}
      papers={[...fixture.papers]}
    />
  );
}

test("opens the page graph from the mode bar and draws one node per retrieved paper", () => {
  const { container } = renderArtifact();

  expect(container.querySelector(".association-layer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "页级关联图" }));

  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(container.querySelectorAll(".association-anchor__chip")).toHaveLength(5);
  // Ten distinct papers, one of them reached from two anchors: ten nodes and eleven edges.
  expect(container.querySelectorAll(".association-node")).toHaveLength(10);
  expect(container.querySelectorAll(".association-edge")).toHaveLength(11);
  expect(container.querySelectorAll(".association-node.is-crossing")).toHaveLength(1);
  expect(screen.getByText("2 个锚点交叉")).toBeVisible();
});

test("a concept in the prose opens the graph focused on itself", () => {
  const { container } = renderArtifact();

  fireEvent.click(screen.getByRole("button", { name: '查看“self-attention”关联论文' }));

  expect(container.querySelector(".association-layer")).not.toBeNull();
  expect(screen.getByText("聚焦概念")).toBeVisible();
  expect(screen.getByText("正在聚焦「self-attention」及其关联文献")).toBeVisible();
  // The other four anchors stay on the page, quietened rather than removed.
  expect(container.querySelectorAll(".association-anchor.is-dimmed")).toHaveLength(4);
});

test("the graph replaces the inline source list rather than adding a second copy of it", () => {
  const { container } = renderArtifact();

  fireEvent.click(screen.getByRole("button", { name: "页级关联图" }));

  expect(container.querySelector(".thin-reading__anchor-sources")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /核心方法的原始定义与理论依据/u }));
  expect(container.querySelector(".association-reading-card")).not.toBeNull();
  expect(screen.getByText("Esc 返回关联图")).toBeVisible();
});

test("closing the graph leaves the prose exactly as it was", () => {
  const { container } = renderArtifact();
  const toggle = screen.getByRole("button", { name: "页级关联图" });

  fireEvent.click(toggle);
  expect(container.querySelector(".thin-reading__body.is-graph-dimmed")).not.toBeNull();

  fireEvent.click(toggle);
  expect(container.querySelector(".association-layer")).toBeNull();
  expect(container.querySelector(".thin-reading__body.is-graph-dimmed")).toBeNull();
  expect(screen.getByText("概念留在正文原位 · 点击展开它的关联")).toBeVisible();
});
