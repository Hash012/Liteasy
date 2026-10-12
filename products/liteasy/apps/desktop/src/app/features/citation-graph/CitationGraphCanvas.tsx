import { Button, Tooltip } from "@fluentui/react-components";
import { ZoomInRegular, ZoomOutRegular, ScaleFitRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { Background, Panel, Handle, MarkerType, Position, ReactFlow, useNodesState, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { CitationGraph, CitationNode } from "./citationGraph";
import "@xyflow/react/dist/style.css";

type PaperNode = Node<{ title: string; local: boolean; selected: boolean; faded: boolean }, "paper">;
function PaperDot({ data }: NodeProps<PaperNode>) {
  return <div className={`citation-graph-dot${data.local ? " local" : " discovered"}${data.selected ? " selected" : ""}${data.faded ? " faded" : ""}`} title={data.title}>
    <Handle type="target" position={Position.Left} isConnectable={false} /><span aria-hidden="true" className="citation-graph-dot-circle" />
    <span className="citation-graph-node-title">{data.title}</span><Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
}
const nodeTypes = { paper: PaperDot };
export function CitationGraphCanvas({ graph, selected, onSelect, onOpen }: { graph: CitationGraph; selected?: string; onSelect: (id: string) => void; onOpen: (node: CitationNode) => void }) {
  const [flow, setFlow] = useState<ReactFlowInstance<PaperNode>>();
  useEffect(() => {
    const timer = window.setTimeout(() => void flow?.fitView({ padding: 0.2, duration: 150 }), 80);
    return () => window.clearTimeout(timer);
  }, [flow, graph]);
  const initial = useMemo<PaperNode[]>(() => {
    const positions = graph.nodes.map((node, i) => ({ id: node.id, x: Math.cos(i * 2.4) * Math.sqrt(i + 1) * 60, y: Math.sin(i * 2.4) * Math.sqrt(i + 1) * 60 }));
    forceSimulation(positions).force("center", forceCenter(0, 0)).force("charge", forceManyBody().strength(-450))
      .force("collide", forceCollide(70)).force("links", forceLink(graph.edges.map((edge) => ({ source: edge.source, target: edge.target })))
        .id((node) => (node as { id: string }).id).distance(180)).stop().tick(100);
    return graph.nodes.map((node, i) => ({ id: node.id, type: "paper", position: { x: positions[i].x, y: positions[i].y },
      ariaLabel: node.title, data: { title: node.title, local: node.localIds.length > 0, selected: false, faded: false } }));
  }, [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<PaperNode>(initial);
  useEffect(() => { setNodes((previous) => initial.map((node) => ({ ...node, position: previous.find((old) => old.id === node.id)?.position ?? node.position }))); }, [initial, setNodes]);
  const nearby = new Set([selected, ...graph.edges.flatMap((edge) => edge.source === selected ? [edge.target] : edge.target === selected ? [edge.source] : [])]);
  return <ReactFlow nodes={nodes.map((node) => ({ ...node, selected: node.id === selected, data: { ...node.data, selected: node.id === selected, faded: Boolean(selected && !nearby.has(node.id)) } }))}
    edges={graph.edges.map((edge) => ({ ...edge, markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--colorNeutralForeground3)", opacity: !selected || nearby.has(edge.source) && nearby.has(edge.target) ? 0.65 : 0.13 } }))}
    nodeTypes={nodeTypes} onInit={setFlow} onNodesChange={onNodesChange} fitView minZoom={0.1} maxZoom={2} nodesConnectable={false}
    onNodeClick={(_, node) => onSelect(node.id)} onNodeDoubleClick={(_, node) => { const target = graph.nodes.find((item) => item.id === node.id); if (target) onOpen(target); }}
    proOptions={{ hideAttribution: true }}>
    <Background gap={24} size={1} /><Panel position="bottom-left" className="citation-graph-zoom">
      <Tooltip content="放大引用图" relationship="label"><Button size="small" aria-label="放大引用图" icon={<ZoomInRegular />} onClick={() => void flow?.zoomIn()} /></Tooltip>
      <Tooltip content="缩小引用图" relationship="label"><Button size="small" aria-label="缩小引用图" icon={<ZoomOutRegular />} onClick={() => void flow?.zoomOut()} /></Tooltip>
      <Tooltip content="显示全部节点" relationship="label"><Button size="small" aria-label="显示全部节点" icon={<ScaleFitRegular />} onClick={() => void flow?.fitView({ padding: 0.2 })} /></Tooltip>
    </Panel>
  </ReactFlow>;
}
