import { Button, Radio, RadioGroup, Tooltip } from "@fluentui/react-components";
import { ArrowSyncRegular, FlowchartRegular, FullScreenMaximizeRegular } from "@fluentui/react-icons";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import mermaid from "mermaid";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMermaidValidation } from "./useMermaidValidation";
import "./mermaidPreview.css";

export type MermaidViewMode = "diagram" | "nodes" | "force";

type MermaidPreviewProps = {
  code: string;
  defaultView?: MermaidViewMode;
  onOpenInTab?: () => void;
  title?: string;
};

type ParsedNode = { id: string; label: string };

let mermaidInitialized = false;

function initializeMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    fontFamily: "inherit",
    securityLevel: "strict",
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      edgeLabelBackground: "#ffffff",
      lineColor: "#697b8c",
      primaryBorderColor: "#8aa0b5",
      primaryColor: "#f7f9fb",
      primaryTextColor: "#172b3a",
      secondaryColor: "#eaf3ff",
      tertiaryColor: "#f3f7fb"
    }
  });
  mermaidInitialized = true;
}

function cleanLabel(value: string) {
  return value
    .replace(/^\["?|"?\]$/g, "")
    .replace(/^\("?|"?\)$/g, "")
    .replace(/^\{"?|"?\}$/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNodeToken(token: string) {
  const normalized = token.trim();
  const match = normalized.match(/^([A-Za-z0-9_:-]+)(?:\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}))?$/);
  if (!match) return null;
  return { id: match[1], label: cleanLabel(match[2] ?? match[3] ?? match[4] ?? match[1]) };
}

// This projection intentionally covers the common flowchart subset. The canonical SVG
// remains available for every Mermaid syntax that the library itself supports.
export function projectMermaidFlowchart(code: string): { edges: Edge[]; nodes: ParsedNode[] } {
  const byId = new Map<string, ParsedNode>();
  const edges: Edge[] = [];
  const lines = code.split(/\r?\n/).map((line) => line.trim()).filter((line) => (
    line && !line.startsWith("%%") && !/^(flowchart|graph)\s+/i.test(line) && !/^(classDef|class|style|linkStyle)\b/i.test(line)
  ));
  for (const line of lines) {
    const parts = line.split(/\s*(?:-->|---|-.->|==>|-\.->)\s*/).filter(Boolean);
    if (parts.length < 2) continue;
    const chain = parts.map((part) => parseNodeToken(part.replace(/^\|.*?\|\s*/, "").replace(/\s*\|.*?\|$/, ""))).filter((value): value is ParsedNode => Boolean(value));
    for (const node of chain) byId.set(node.id, node);
    for (let index = 0; index < chain.length - 1; index += 1) {
      edges.push({
        id: `${chain[index].id}-${chain[index + 1].id}-${index}`,
        source: chain[index].id,
        target: chain[index + 1].id,
        type: "smoothstep"
      });
    }
  }
  return { edges, nodes: [...byId.values()] };
}

function MermaidNode({ data }: NodeProps) {
  const label = typeof (data as { label?: unknown }).label === "string"
    ? (data as { label: string }).label
    : "未命名节点";
  return (
    <div className="mermaid-preview__node" title={label}>
      <Handle position={Position.Top} type="target" />
      <span>{label}</span>
      <Handle position={Position.Bottom} type="source" />
    </div>
  );
}

function obsidianNodePreview(label: string) {
  const trimmed = label.replace(/\s+/g, " ").trim();
  const words = trimmed.split(" ").filter(Boolean);
  const preview = words.length > 1
    ? words.slice(0, 4).join(" ")
    : trimmed.slice(0, 10);
  return preview.length < trimmed.length ? `${preview}…` : preview;
}

function obsidianNodeDiameter(label: string) {
  const characters = [...label.trim()].length;
  return Math.max(52, Math.min(106, 45 + Math.sqrt(Math.max(1, characters)) * 9));
}

function ObsidianForceNode({ data }: NodeProps) {
  const label = typeof (data as { label?: unknown }).label === "string"
    ? (data as { label: string }).label
    : "未命名节点";
  const diameter = obsidianNodeDiameter(label);
  return (
    <div
      className="mermaid-preview__obsidian-node"
      style={{ height: diameter, width: diameter }}
      title={label}
    >
      <Handle className="mermaid-preview__obsidian-handle" position={Position.Left} type="target" />
      <span>{obsidianNodePreview(label)}</span>
      <Handle className="mermaid-preview__obsidian-handle" position={Position.Right} type="source" />
    </div>
  );
}

const nodeTypes = { mermaid: MermaidNode, obsidian: ObsidianForceNode };

type ForceVelocity = { x: number; y: number };

function createProjectedNodes(projection: ReturnType<typeof projectMermaidFlowchart>) {
  return projection.nodes.map((node, index) => ({
    data: { label: node.label },
    id: node.id,
    position: {
      x: (index % 3) * 230 + 40,
      y: Math.floor(index / 3) * 130 + 40
    },
    type: "mermaid"
  } satisfies Node));
}

function createObsidianProjectedNodes(projection: ReturnType<typeof projectMermaidFlowchart>) {
  return projection.nodes.map((node, index) => ({
    data: { label: node.label },
    id: node.id,
    position: {
      x: (index % 3) * 200 + 64,
      y: Math.floor(index / 3) * 160 + 64
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    type: "obsidian"
  } satisfies Node));
}

export function advanceMermaidForceLayout(
  nodes: Node[],
  edges: Edge[],
  velocities: Map<string, ForceVelocity>,
  heldNodeId?: string
) {
  const nextVelocities = new Map(velocities);
  const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
  const desiredLinkLength = 230;

  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const first = nodes[left];
      const second = nodes[right];
      const dx = second.position.x - first.position.x;
      const dy = second.position.y - first.position.y;
      const squaredDistance = Math.max(1, dx * dx + dy * dy);
      const distance = Math.sqrt(squaredDistance);
      const strength = 18_000 / squaredDistance;
      const forceX = (dx / distance) * strength;
      const forceY = (dy / distance) * strength;
      const firstForce = forces.get(first.id)!;
      const secondForce = forces.get(second.id)!;
      firstForce.x -= forceX;
      firstForce.y -= forceY;
      secondForce.x += forceX;
      secondForce.y += forceY;
    }
  }

  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) continue;
    const dx = target.position.x - source.position.x;
    const dy = target.position.y - source.position.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const strength = (distance - desiredLinkLength) * 0.014;
    const forceX = (dx / distance) * strength;
    const forceY = (dy / distance) * strength;
    const sourceForce = forces.get(source.id)!;
    const targetForce = forces.get(target.id)!;
    sourceForce.x += forceX;
    sourceForce.y += forceY;
    targetForce.x -= forceX;
    targetForce.y -= forceY;
  }

  return nodes.map((node) => {
    if (node.id === heldNodeId) return node;
    const force = forces.get(node.id)!;
    const velocity = nextVelocities.get(node.id) ?? { x: 0, y: 0 };
    const nextVelocity = {
      x: (velocity.x + force.x - node.position.x * 0.0009) * 0.86,
      y: (velocity.y + force.y - node.position.y * 0.0009) * 0.86
    };
    nextVelocities.set(node.id, nextVelocity);
    return {
      ...node,
      position: {
        x: node.position.x + Math.max(-18, Math.min(18, nextVelocity.x)),
        y: node.position.y + Math.max(-18, Math.min(18, nextVelocity.y))
      }
    };
  });
}

function GraphProjection({ code }: { code: string }) {
  const projection = useMemo(() => projectMermaidFlowchart(code), [code]);
  const initialNodes = useMemo<Node[]>(() => createProjectedNodes(projection), [projection]);
  const [nodes, setNodes] = useState(initialNodes);

  useEffect(() => setNodes(initialNodes), [initialNodes]);

  if (nodes.length === 0) {
    return <p className="mermaid-preview__empty">此图形语法暂不能投影为节点；请切换到 Mermaid 图查看完整内容。</p>;
  }

  return (
    <div className="mermaid-preview__graph" aria-label="可拖拽 Mermaid 节点图">
      <ReactFlow
        edges={projection.edges}
        fitView
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => setNodes((current) => changes.reduce<Node[]>((next, change) => {
          if (change.type !== "position" || !change.position) return next;
          return next.map((node) => node.id === change.id ? { ...node, position: change.position! } : node);
        }, current))}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function ForceDirectedProjection({ code }: { code: string }) {
  const projection = useMemo(() => projectMermaidFlowchart(code), [code]);
  const forceEdges = useMemo<Edge[]>(() => projection.edges.map((edge) => ({
    ...edge,
    markerEnd: undefined,
    style: { stroke: "#697b8c", strokeWidth: 1 },
    type: "straight"
  })), [projection.edges]);
  const initialNodes = useMemo<Node[]>(() => createObsidianProjectedNodes(projection), [projection]);
  const [nodes, setNodes] = useState(initialNodes);
  const nodesRef = useRef(initialNodes);
  const velocitiesRef = useRef(new Map<string, ForceVelocity>());
  const heldNodeIdRef = useRef<string>();

  useEffect(() => {
    nodesRef.current = initialNodes;
    velocitiesRef.current = new Map();
    setNodes(initialNodes);
  }, [initialNodes]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = advanceMermaidForceLayout(
        nodesRef.current,
        forceEdges,
        velocitiesRef.current,
        heldNodeIdRef.current
      );
      nodesRef.current = next;
      setNodes(next);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [forceEdges]);

  const moveHeldNode = useCallback((_: unknown, node: Node) => {
    heldNodeIdRef.current = node.id;
    nodesRef.current = nodesRef.current.map((current) => current.id === node.id
      ? { ...current, position: node.position }
      : current);
    setNodes(nodesRef.current);
  }, []);

  const releaseHeldNode = useCallback((_: unknown, node: Node) => {
    const previous = nodesRef.current.find((current) => current.id === node.id)?.position;
    velocitiesRef.current.set(node.id, {
      x: previous ? (node.position.x - previous.x) * 0.25 : 0,
      y: previous ? (node.position.y - previous.y) * 0.25 : 0
    });
    heldNodeIdRef.current = undefined;
  }, []);

  if (nodes.length === 0) {
    return <p className="mermaid-preview__empty">此图形语法暂不能投影为节点；请切换到 Mermaid 图查看完整内容。</p>;
  }

  return (
    <div className="mermaid-preview__graph mermaid-preview__graph--force" aria-label="Obsidian 风格的自适应 Mermaid 节点图">
      <ReactFlow
        edges={forceEdges}
        fitView
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodeDrag={moveHeldNode}
        onNodeDragStart={moveHeldNode}
        onNodeDragStop={releaseHeldNode}
        proOptions={{ hideAttribution: true }}
      >
      </ReactFlow>
    </div>
  );
}

function StandardMermaid({ code, validationError }: { code: string; validationError?: string }) {
  const reactId = useId().replace(/[^a-z0-9]/gi, "");
  const [state, setState] = useState<{ error?: string; svg?: string }>({});

  useEffect(() => {
    let cancelled = false;
    initializeMermaid();
    void mermaid.render(`liteasy-mermaid-${reactId}`, code)
      .then(({ svg }) => !cancelled && setState({ svg }))
      .catch(() => !cancelled && setState({ error: "图形语法无法渲染。可编辑 Mermaid 后重试。" }));
    return () => { cancelled = true; };
  }, [code, reactId]);

  if (validationError || state.error) return null;
  return state.svg ? <div className="mermaid-preview__svg" dangerouslySetInnerHTML={{ __html: state.svg }} /> : <p className="mermaid-preview__loading">正在渲染图形…</p>;
}

export function MermaidPreview({ code, defaultView = "diagram", onOpenInTab, title = "关系图" }: MermaidPreviewProps) {
  const [view, setView] = useState<MermaidViewMode>(defaultView);
  const normalizedCode = code.trim();
  const validation = useMermaidValidation(normalizedCode);

  useEffect(() => setView(defaultView), [code, defaultView]);
  if (!normalizedCode) return null;

  return (
    <section className="mermaid-preview" aria-label={title}>
      <header className="mermaid-preview__header">
        <div><FlowchartRegular aria-hidden="true" /><strong>{title}</strong></div>
        <RadioGroup aria-label="Mermaid 视图" layout="horizontal" value={view} onChange={(_, data) => setView(data.value as MermaidViewMode)}>
          <Radio label="Mermaid 图" value="diagram" />
          <Radio label="节点图" value="nodes" />
          <Radio label="自适应节点图" value="force" />
        </RadioGroup>
        <Tooltip content="重新渲染" relationship="label">
          <Button appearance="subtle" aria-label="重新渲染 Mermaid 图" icon={<ArrowSyncRegular />} onClick={() => setView((current) => current === "diagram" ? "nodes" : "diagram")} onDoubleClick={() => setView(defaultView)} />
        </Tooltip>
        {onOpenInTab ? (
          <Tooltip content="在独立标签页放大查看" relationship="label">
            <Button appearance="subtle" aria-label={`放大查看：${title}`} icon={<FullScreenMaximizeRegular />} onClick={onOpenInTab} />
          </Tooltip>
        ) : null}
      </header>
      {validation.repaired && !validation.error ? <p className="mermaid-preview__repaired">已自动修正图形语法。</p> : null}
      {validation.error ? (
        <div className="mermaid-preview__fallback" aria-live="polite">
          <strong>关系图已自动转为可读节点视图。</strong>
          <GraphProjection code={validation.code} />
        </div>
      ) : view === "diagram" ? <StandardMermaid code={validation.code} /> : view === "force" ? <ForceDirectedProjection code={validation.code} /> : <GraphProjection code={validation.code} />}
    </section>
  );
}
