import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeChange, type NodeMouseHandler, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { useEffect, useMemo, useState } from "react";
import { ThinReadingMindMap } from "./ThinReadingMindMap";
import type { ThinReadingDocument, ThinReadingNode } from "./thinReading.types";

type ThinReadingGraphViewProps = {
  activeNodeId: string;
  document: ThinReadingDocument;
  onClose?: () => void;
  onOpenInTab?: () => void;
  onSelectNode: (nodeId: string) => void;
  onViewModeChange: (mode: ThinReadingGraphMode) => void;
  viewMode: ThinReadingGraphMode;
};

export type ThinReadingGraphMode = "mindmap" | "network";

type LayoutPoint = { id: string; x: number; y: number };

function nodeRadius(depth: number) {
  return Math.max(25, 62 - depth * 9);
}

function nodeLabel(value: string, limit = 22) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

function CenterLinkedNode({ data }: NodeProps) {
  const centerHandleStyle = {
    background: "transparent",
    border: 0,
    height: 2,
    left: "50%",
    opacity: 0,
    pointerEvents: "none" as const,
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: 2
  };
  return <>
    <Handle id="center-target" isConnectable={false} position={Position.Top} style={centerHandleStyle} type="target" />
    <span>{(data as { label?: string }).label ?? "未命名页面"}</span>
    <Handle id="center-source" isConnectable={false} position={Position.Top} style={centerHandleStyle} type="source" />
  </>;
}

const nodeTypes = { centerLinked: CenterLinkedNode };

function forceLayout(nodes: ThinReadingNode[], edges: Edge[]) {
  const points: LayoutPoint[] = nodes.map((node, index) => {
    const angle = index / Math.max(nodes.length, 1) * Math.PI * 2;
    return { id: node.id, x: 420 + Math.cos(angle) * 230, y: 280 + Math.sin(angle) * 180 };
  });
  forceSimulation(points)
    .force("charge", forceManyBody().strength(-1_050))
    .force("center", forceCenter(420, 280))
    .force("collide", forceCollide<LayoutPoint>((point) => nodeRadius(nodes.find((node) => node.id === point.id)?.depth ?? 2) + 20))
    .force("link", forceLink<LayoutPoint, { source: string; target: string }>(edges.map((edge) => ({ source: edge.source, target: edge.target }))).id((point) => point.id).distance(200).strength(.72))
    .stop()
    .tick(260);
  return new Map(points.map((point) => [point.id, point]));
}

export function ThinReadingGraphView({
  activeNodeId,
  document,
  onClose,
  onOpenInTab,
  onSelectNode,
  onViewModeChange,
  viewMode
}: ThinReadingGraphViewProps) {
  const nodes = useMemo(() => Object.values(document.nodes), [document.nodes]);
  const levels = useMemo(() => [...new Set(nodes.map((node) => node.depth))].sort((left, right) => left - right), [nodes]);
  const [selectedLevel, setSelectedLevel] = useState(() => levels[0] ?? 0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const maxLevel = levels[levels.length - 1] ?? selectedLevel;
  const normalizedLevel = Math.min(Math.max(selectedLevel, levels[0] ?? 0), maxLevel);
  useEffect(() => {
    if (viewMode === "mindmap") setSelectedLevel(maxLevel);
  }, [maxLevel, viewMode]);
  const rawEdges = useMemo<Edge[]>(() => nodes.flatMap((node) => node.childIds.flatMap((childId) => (
    document.nodes[childId] ? [{ id: `${node.id}-${childId}`, source: node.id, sourceHandle: "center-source", target: childId, targetHandle: "center-target", type: "straight" }] : []
  ))), [document.nodes, nodes]);
  const positions = useMemo(() => forceLayout(nodes, rawEdges), [nodes, rawEdges]);
  const [manualPositions, setManualPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  useEffect(() => setManualPositions(new Map()), [document.artifactId, document.nodes, viewMode]);
  const neighborhood = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    return new Set([hoveredNodeId, ...rawEdges.flatMap((edge) => (
      edge.source === hoveredNodeId ? [edge.target] : edge.target === hoveredNodeId ? [edge.source] : []
    ))]);
  }, [hoveredNodeId, rawEdges]);
  const flowNodes: Node[] = nodes.map((node) => {
    const radius = nodeRadius(node.depth);
    const fadedByLevel = node.depth > normalizedLevel;
    const fadedByHover = neighborhood.size > 0 && !neighborhood.has(node.id);
    const active = node.id === activeNodeId;
    return {
      data: { label: nodeLabel(node.title) },
      id: node.id,
      type: "centerLinked",
      position: manualPositions.get(node.id) ?? positions.get(node.id) ?? { x: 0, y: 0 },
      style: {
        alignItems: "center", background: active ? "#d8ede7" : "#f7fbf9",
        border: `${active ? 3 : 1.5}px solid ${active ? "#236f69" : "#5f928a"}`,
        borderRadius: "50%", color: "#284e4d", display: "flex", fontSize: Math.max(10, 13 - node.depth),
        fontWeight: active ? 700 : 600, height: radius * 2, justifyContent: "center", lineHeight: 1.35,
        opacity: fadedByLevel ? .3 : fadedByHover ? .2 : 1, padding: 10, textAlign: "center",
        transition: "opacity 160ms ease, background 160ms ease", width: radius * 2
      },
      title: node.title
    };
  });
  const flowEdges: Edge[] = rawEdges.map((edge) => {
    const target = document.nodes[edge.target];
    const muted = target?.depth > normalizedLevel;
    const outsideHover = neighborhood.size > 0 && (!neighborhood.has(edge.source) || !neighborhood.has(edge.target));
    return {
      ...edge,
      type: "straight",
      style: { opacity: muted ? .32 : outsideHover ? .12 : .78, stroke: muted ? "#b2c5c1" : "#6e9f98", strokeDasharray: muted ? "6 6" : undefined, strokeWidth: 1.35 }
    };
  });
  const onNodeClick: NodeMouseHandler = (_, node) => onSelectNode(node.id);
  function persistDraggedNodePositions(changes: NodeChange[]) {
    setManualPositions((current) => {
      const next = new Map(current);
      changes.forEach((change) => {
        if (change.type === "position" && change.position) next.set(change.id, change.position);
      });
      return next;
    });
  }

  return (
    <section className={`thin-reading__graph is-${viewMode}`} aria-label="薄读页面关系图">
      <div className="thin-reading__graph-heading">
        <div>
          <div className="thin-reading__article-meta">{viewMode === "mindmap" ? "MIND MAP" : "RELATIONSHIP NETWORK"}</div>
          <h2>{viewMode === "mindmap" ? "薄读层次思维导图" : "薄读页面网络"}</h2>
          <p>{viewMode === "mindmap"
            ? "前两级向右派生，更深节点在父节点下方单列展开；拖动节点到最右侧可复制为对照分栏。"
            : "基于页面之间的深入关系形成自适应网络；拖动可调整观察位置。"}</p>
        </div>
        <div className="thin-reading__graph-actions">
          <div className="thin-reading__graph-mode-switch" aria-label="选择薄读结构图形式" role="group">
            <button aria-pressed={viewMode === "network"} onClick={() => onViewModeChange("network")} type="button">关系网络</button>
            <button aria-pressed={viewMode === "mindmap"} onClick={() => onViewModeChange("mindmap")} type="button">思维导图</button>
          </div>
          <label className="thin-reading__graph-level">
            <span>显示层级</span>
            <select aria-label="选择要聚焦的薄读层级" onChange={(event) => setSelectedLevel(Number(event.target.value))} value={normalizedLevel}>
              {levels.map((level) => <option key={level} value={level}>第 {level + 1} 层</option>)}
            </select>
          </label>
          {onOpenInTab ? <button className="thin-reading__graph-expand" onClick={onOpenInTab} type="button">放大查看</button> : null}
          {onClose ? <button className="thin-reading__graph-expand" onClick={onClose} type="button">收起结构图</button> : null}
        </div>
      </div>
      <div className="thin-reading__graph-legend" aria-label="图例">
        <span><i className="is-solid" />已聚焦页面</span>
        <span><i className="is-muted" />更深层页面</span>
        {viewMode === "mindmap" ? <span>拖动节点到最右侧可创建对照</span> : null}
      </div>
      {viewMode === "mindmap" ? (
        <ThinReadingMindMap
          activeNodeId={activeNodeId}
          document={document}
          maxVisibleDepth={normalizedLevel}
          onSelectNode={onSelectNode}
        />
      ) : <div className="thin-reading__graph-canvas thin-reading__graph-canvas--network">
        <ReactFlow
          edges={flowEdges}
          fitView
          fitViewOptions={{ padding: .24 }}
          maxZoom={1.6}
          minZoom={.1}
          nodes={flowNodes}
          nodeTypes={nodeTypes}
          onNodesChange={persistDraggedNodePositions}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
          onNodeMouseLeave={() => setHoveredNodeId(undefined)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>}
      <ul className="thin-reading__graph-accessible-list" aria-label="薄读页面列表">
        {nodes.map((node) => <li key={node.id}><button onClick={() => onSelectNode(node.id)} type="button">{node.title}</button></li>)}
      </ul>
    </section>
  );
}
