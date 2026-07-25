import { Background, Controls, ReactFlow, type Edge, type Node, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { useMemo, useState } from "react";
import type { IntuitionGraphDocument, IntuitionGraphNode } from "../intuition-graph/intuitionGraph.types";
import { projectIntuitionGraph } from "./graphProjection";
import type { GraphViewState, GraphRadius, SemanticLevelPreference } from "./layeredReading.types";

type GraphCanvasProps = {
  graph: IntuitionGraphDocument;
  view: GraphViewState;
  onViewChange: (next: GraphViewState) => void;
  onExpand?: (nodeId: string) => void;
};

type LayoutNode = { id: string; x: number; y: number };

function layout(nodes: IntuitionGraphNode[], edges: { sourceNodeId: string; targetNodeId: string }[]) {
  const points: LayoutNode[] = nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    return { id: node.id, x: 280 + Math.cos(angle) * 160, y: 190 + Math.sin(angle) * 120 };
  });
  forceSimulation(points)
    .force("charge", forceManyBody().strength(-380))
    .force("center", forceCenter(280, 190))
    .force("collide", forceCollide(52))
    .force("link", forceLink<LayoutNode, { source: string; target: string }>(edges.map((edge) => ({ source: edge.sourceNodeId, target: edge.targetNodeId }))).id((node) => node.id).distance(130).strength(0.65))
    .stop()
    .tick(180);
  return new Map(points.map((point) => [point.id, point]));
}

function nodeLabel(node: IntuitionGraphNode) {
  return node.status === "complete" ? node.label : `${node.label} · 待展开`;
}

export function ObsidianLikeGraphCanvas({ graph, view, onViewChange, onExpand }: GraphCanvasProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const projection = useMemo(() => projectIntuitionGraph(graph, view), [graph, view]);
  const positions = useMemo(() => layout(projection.nodes, projection.edges), [projection.edges, projection.nodes]);
  const neighborhood = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    return new Set([hoveredNodeId, ...projection.edges.flatMap((edge) => edge.sourceNodeId === hoveredNodeId ? [edge.targetNodeId] : edge.targetNodeId === hoveredNodeId ? [edge.sourceNodeId] : [])]);
  }, [hoveredNodeId, projection.edges]);
  const nodes: Node[] = projection.nodes.map((node) => {
    const point = positions.get(node.id) ?? { x: 0, y: 0 };
    const focused = node.id === projection.focusNodeId;
    const faded = neighborhood.size > 0 && !neighborhood.has(node.id);
    return {
      data: { label: nodeLabel(node) }, id: node.id, position: { x: point.x, y: point.y },
      style: {
        background: node.status === "stub" ? "#e8eef6" : node.kind === "intuition" ? "#e7d9ff" : node.kind === "limitation" ? "#ffe5df" : "#d9f2ec",
        border: focused ? "3px solid #125d71" : "1px solid #5c7180", borderRadius: 999, color: "#173844",
        fontSize: 12, maxWidth: 190, opacity: faded ? 0.22 : 1, padding: "10px 14px", transition: "opacity 120ms ease"
      }
    };
  });
  const edges: Edge[] = projection.edges.map((edge) => ({
    id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId,
    animated: edge.kind === "expands", label: edge.label,
    style: { opacity: !hoveredNodeId || neighborhood.has(edge.sourceNodeId) && neighborhood.has(edge.targetNodeId) ? 0.78 : 0.12, stroke: "#78909c" }
  }));
  const focus = projection.nodes.find((node) => node.id === projection.focusNodeId);
  const changeLevel = (semanticLevel: SemanticLevelPreference) => onViewChange({ ...view, semanticLevel });
  const onNodeClick: NodeMouseHandler = (_, node) => onViewChange({ ...view, focusNodeId: node.id });

  return (
    <section className="layered-graph" aria-label="论文认知图">
      <header className="layered-graph-toolbar">
        <div className="layered-graph-control"><span>内容</span>{(["auto", 0, 1, 2, 3, 4] as SemanticLevelPreference[]).map((level) => <button className={view.semanticLevel === level ? "active" : ""} key={String(level)} onClick={() => changeLevel(level)} type="button">{level === "auto" ? "自动" : `L${level}`}</button>)}</div>
        <div className="layered-graph-control"><span>邻域</span>{([1, 2, 3] as GraphRadius[]).map((radius) => <button className={view.graphRadius === radius ? "active" : ""} key={radius} onClick={() => onViewChange({ ...view, graphRadius: radius })} type="button">{radius} 跳</button>)}</div>
      </header>
      <div className="layered-graph-content">
        <div className="layered-graph-canvas">
          <ReactFlow edges={edges} fitView nodes={nodes} onNodeClick={onNodeClick} onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)} onNodeMouseLeave={() => setHoveredNodeId(undefined)} proOptions={{ hideAttribution: true }}>
            <Background gap={18} size={1} /><Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="layered-graph-detail" aria-live="polite">
          {focus ? <><strong>{nodeLabel(focus)}</strong>{focus.status === "complete" ? <><p>{focus.summary}</p><small>{focus.kind} · L{focus.baseLevel} · {focus.evidenceIds.length} 条证据</small></> : <p>这是尚未生成详细解释的入口节点。</p>}{focus.expandable && onExpand ? <button onClick={() => onExpand(focus.id)} type="button">深入一层</button> : null}</> : <p>选择一个节点查看详情。</p>}
        </aside>
      </div>
      <ul className="layered-graph-accessible-list" aria-label="论文认知图节点列表">
        {projection.nodes.map((node) => <li key={node.id}><button onClick={() => onViewChange({ ...view, focusNodeId: node.id })} type="button">{nodeLabel(node)}</button>{node.status === "complete" ? <span>{node.summary}</span> : null}</li>)}
      </ul>
    </section>
  );
}
