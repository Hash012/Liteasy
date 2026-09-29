import { useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, applyNodeChanges, type Connection, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowDefinition } from "../workflows/workflowDefinition";
import type { BoardTemplate } from "../extensions/extensionPackage";
export function StudioGraph({ value, onChange, onSelect }: { value: WorkflowDefinition | BoardTemplate; onChange(value: WorkflowDefinition | BoardTemplate): void; onSelect(id: string): void }) {
  const workflow = value.schema === "liteasy.workflow/v2";
  const nodes: Node[] = useMemo(() => workflow ? value.nodes.map((node, i) => ({ id: node.id, position: value.layout[node.id] ?? { x: (i % 3) * 240, y: Math.floor(i / 3) * 130 }, data: { label: `${node.title}\n${node.operation.id}` }, ariaLabel: node.title })) : value.cards.map((card) => ({ id: card.id, position: card.position, data: { label: card.title }, style: { width: card.size.width, minHeight: card.size.height }, ariaLabel: card.title })), [value]);
  const [displayNodes, setDisplayNodes] = useState(nodes);
  useEffect(() => { setDisplayNodes(nodes); }, [nodes]);
  const edges: Edge[] = workflow ? value.edges.map((edge, i) => ({ id: `edge-${i}`, source: edge.from, target: edge.to, label: edge.when === undefined ? undefined : edge.when ? "是" : "否" })) : [];
  const connect = (connection: Connection) => { if (workflow) onChange({ ...value, edges: [...value.edges, { from: connection.source, to: connection.target }] }); };
  return <div className="studio-graph" aria-label={workflow ? "工作流画布" : "组合布局"}><ReactFlow nodes={displayNodes} onNodesChange={(changes) => setDisplayNodes((items) => applyNodeChanges(changes, items))} edges={edges} onConnect={connect} onNodeClick={(_, node) => onSelect(node.id)} onNodeDragStop={(_, node) => {
    if (workflow) onChange({ ...value, layout: { ...value.layout, [node.id]: node.position } });
    else onChange({ ...value, cards: value.cards.map((card) => card.id === node.id ? { ...card, position: { x: Math.max(0, node.position.x), y: Math.max(0, node.position.y) } } : card) });
  }} onEdgesDelete={(removed) => { if (workflow) onChange({ ...value, edges: value.edges.filter((_, i) => !removed.some((edge) => edge.id === `edge-${i}`)) }); }} fitView onlyRenderVisibleElements deleteKeyCode="Delete"><Background gap={18} /><Controls /></ReactFlow></div>;
}
