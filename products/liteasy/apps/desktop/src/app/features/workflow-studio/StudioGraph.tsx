import { operationLabels } from "../workflows/operationCatalog";
import { useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, applyNodeChanges, type Connection, type Node, type Edge, type NodeProps, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useApplicationColorScheme } from "../theme/ApplicationThemeProvider";
import type { WorkflowDefinition } from "../workflows/workflowDefinition";
import type { BoardTemplate } from "../extensions/extensionPackage";
import type { DerivedBlockDefinition } from "../visual-blocks/blockRegistry";
import { StudioCardPreview } from "./StudioCardPreview";

type CardNode = Node<{ card: BoardTemplate["cards"][number]; blocks: DerivedBlockDefinition[] }, "card">;
function CardPreviewNode({ data }: NodeProps<CardNode>) {
  return <article className="studio-card-node"><header>{data.card.title}</header><div className="studio-card-body nodrag nowheel"><StudioCardPreview card={data.card} blocks={data.blocks} /></div></article>;
}
const nodeTypes = { card: CardPreviewNode };
const noBlocks: DerivedBlockDefinition[] = [];
export const studioEdgeId = (edge: WorkflowDefinition["edges"][number]) => JSON.stringify([edge.from, edge.to, edge.when ?? null]);
export function StudioGraph({ value, onChange, onSelect, blocks = noBlocks, readOnly = false }: { value: WorkflowDefinition | BoardTemplate; onChange(value: WorkflowDefinition | BoardTemplate): void; onSelect(id: string): void; blocks?: DerivedBlockDefinition[]; readOnly?: boolean }) {
  const scheme = useApplicationColorScheme();
  const workflow = value.schema === "liteasy.workflow/v2";
  const nodes: Node[] = useMemo(() => workflow ? value.nodes.map((node, i) => ({ id: node.id, position: value.layout[node.id] ?? { x: (i % 3) * 240, y: Math.floor(i / 3) * 130 }, data: { label: `${node.title}\n${operationLabels[node.operation.id]}` }, ariaLabel: node.title })) : value.cards.map((card) => ({ id: card.id, type: "card", position: card.position, data: { card, blocks }, style: { width: card.size.width, height: card.size.height }, ariaLabel: card.title })), [value, blocks, workflow]);
  const [displayNodes, setDisplayNodes] = useState(nodes);
  useEffect(() => { setDisplayNodes((old) => nodes.map((node) => ({ ...node, selected: old.find((item) => item.id === node.id)?.selected }))); }, [nodes]);
  const edges: Edge[] = workflow ? value.edges.map((edge) => ({ id: studioEdgeId(edge), source: edge.from, target: edge.to, label: edge.when === undefined ? undefined : edge.when ? "是" : "否" })) : [];
  function changeNodes(changes: NodeChange[]) {
    setDisplayNodes((items) => applyNodeChanges(changes, items));
    const positions = new Map(changes.flatMap((change) => change.type === "position" && change.position && change.dragging !== true ? [[change.id, change.position] as const] : []));
    if (readOnly || !positions.size) return;
    if (workflow) onChange({ ...value, layout: { ...value.layout, ...Object.fromEntries(positions) } });
    else onChange({ ...value, cards: value.cards.map((card) => { const position = positions.get(card.id); return position ? { ...card, position: { x: Math.min(100000, Math.max(0, position.x)), y: Math.min(100000, Math.max(0, position.y)) } } : card; }) });
  }
  const connect = (connection: Connection) => { if (!readOnly && workflow && !value.edges.some((edge) => edge.from === connection.source && edge.to === connection.target && edge.when === undefined)) onChange({ ...value, edges: [...value.edges, { from: connection.source, to: connection.target }] }); };
  return <div className="studio-graph" aria-label={workflow ? "工作流画布" : "组合布局"}><ReactFlow colorMode={scheme} nodeTypes={nodeTypes} nodes={displayNodes} nodesDraggable={!readOnly} nodesConnectable={!readOnly} onNodesChange={changeNodes} edges={edges} onConnect={connect} onNodeClick={(_, node) => onSelect(node.id)} onNodeDragStop={(_, node) => {
    if (readOnly) return;
    if (workflow) onChange({ ...value, layout: { ...value.layout, [node.id]: node.position } });
    else onChange({ ...value, cards: value.cards.map((card) => card.id === node.id ? { ...card, position: { x: Math.max(0, node.position.x), y: Math.max(0, node.position.y) } } : card) });
  }} onDelete={({ nodes: removed, edges: removedEdges }) => {
    if (readOnly) return;
    const ids = new Set(removed.map((node) => node.id));
    if (workflow) onChange({ ...value, nodes: value.nodes.filter((node) => !ids.has(node.id)), edges: value.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to) && !removedEdges.some((item) => item.id === studioEdgeId(edge))), layout: Object.fromEntries(Object.entries(value.layout).filter(([id]) => !ids.has(id))) });
    else onChange({ ...value, cards: value.cards.filter((card) => !ids.has(card.id)) });
  }} fitView minZoom={0.2} deleteKeyCode={readOnly ? null : "Delete"}><Background gap={18} /><Controls /></ReactFlow></div>;
}
