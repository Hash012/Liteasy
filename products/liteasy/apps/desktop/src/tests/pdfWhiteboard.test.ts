import { afterEach, expect, test } from "vitest";
import {
  appendPdfWhiteboardNode,
  createEmptyPdfWhiteboard,
  createPdfWhiteboardEdge,
  createPdfWhiteboardNode
} from "../app/features/pdf/pdf-whiteboard/pdfWhiteboardModel";
import {
  loadPdfWhiteboard,
  normalizePdfWhiteboardDocument,
  pdfWhiteboardStorageKey,
  savePdfWhiteboard
} from "../app/features/pdf/pdf-whiteboard/pdfWhiteboardStorage";

afterEach(() => window.localStorage.clear());

test("models Markdown, image, and future literature whiteboard nodes", () => {
  const markdown = createPdfWhiteboardNode(
    { kind: "markdown", markdown: "**核心结论**" },
    { x: 30, y: 40 }
  );
  const image = createPdfWhiteboardNode({
    alt: "Figure 1",
    dataUrl: "data:image/png;base64,AA==",
    kind: "image",
    mimeType: "image/png"
  }, { x: 100, y: 120 });
  const literature = createPdfWhiteboardNode({
    kind: "literature",
    literatureId: "literature-2",
    title: "Related Work"
  }, { x: 180, y: 80 });

  expect(markdown.kind).toBe("markdown");
  expect(markdown.size).toEqual({ height: 120, width: 230 });
  expect(image.kind).toBe("image");
  expect(literature.kind).toBe("literature");
});

test("normalizes a whiteboard and removes edges whose nodes no longer exist", () => {
  const first = createPdfWhiteboardNode({ kind: "markdown", markdown: "A" }, { x: 0, y: 0 });
  const second = createPdfWhiteboardNode({ kind: "markdown", markdown: "B" }, { x: 200, y: 0 });
  const edge = createPdfWhiteboardEdge(first.id, second.id);
  const normalized = normalizePdfWhiteboardDocument({
    ...createEmptyPdfWhiteboard("paper-1"),
    edges: [edge, { ...edge, id: "dangling", targetNodeId: "missing" }],
    nodes: [first, second]
  }, "paper-1");

  expect(normalized.nodes).toHaveLength(2);
  expect(normalized.edges).toEqual([edge]);
  expect(normalizePdfWhiteboardDocument({ version: 8 }, "paper-1").nodes).toEqual([]);
});

test("persists each PDF whiteboard under its account and paper scope", () => {
  const paper = { id: "paper-1", sourcePath: "/papers/one.pdf" };
  const key = pdfWhiteboardStorageKey(paper);
  const node = createPdfWhiteboardNode({ kind: "markdown", markdown: "持久化想法" }, { x: 20, y: 20 });
  const document = appendPdfWhiteboardNode(createEmptyPdfWhiteboard(paper.id), node);

  savePdfWhiteboard(key, document);

  expect(key).toContain(":guest:paper-1:");
  expect(loadPdfWhiteboard(key, paper.id).nodes[0]).toMatchObject({
    content: { markdown: "持久化想法" },
    kind: "markdown"
  });
});
