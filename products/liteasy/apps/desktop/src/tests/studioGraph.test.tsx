import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StudioGraph, studioEdgeId } from "../app/features/workflow-studio/StudioGraph";
import type { BoardTemplate } from "../app/features/extensions/extensionPackage";

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: any) => <div>{props.nodes.map((node: any) => { const View = props.nodeTypes?.[node.type]; return <section key={node.id}>{View ? <View data={node.data} /> : node.data.label}</section>; })}<button onClick={() => { props.onNodesChange?.([{ id: "one", type: "remove" }]); props.onNodesDelete?.([{ id: "one" }]); props.onDelete?.({ nodes: [{ id: "one" }], edges: [] }); }}>Delete selected</button></div>,
  Background: () => null, Controls: () => null, Handle: () => null, Position: {},
  applyNodeChanges: (changes: any[], nodes: any[]) => nodes.filter((node) => !changes.some((change) => change.type === "remove" && change.id === node.id)),
}));
const board: BoardTemplate = { schema: "liteasy.board-template/v1", id: "example", title: "演示数据", cards: [{ id: "one", title: "研究问题", type: { id: "liteasy/RichTextBlock", version: "1.0.0" }, data: { text: "真实卡片正文" }, position: { x: 0, y: 0 }, size: { width: 320, height: 240 } }] };
test("composition renders its real card body through the component registry", () => {
  render(<StudioGraph value={board} onChange={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByText("真实卡片正文")).toBeInTheDocument();
});
test("Delete writes removal into the canonical composition", () => {
  const change = vi.fn();
  render(<StudioGraph value={board} onChange={change} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByText("Delete selected"));
  expect(change).toHaveBeenCalledWith({ ...board, cards: [] });
});

test("workflow edges retain identity after unrelated edge removal", () => {
  const first = { from: "a", to: "b" }, second = { from: "b", to: "c", when: true };
  expect([first, second].map(studioEdgeId)[1]).toBe([second].map(studioEdgeId)[0]);
  expect(studioEdgeId(second)).not.toBe(studioEdgeId({ ...second, when: false }));
});
