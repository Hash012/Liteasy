import { DismissRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { ThinReadingDocument, ThinReadingNode } from "./thinReading.types";

type ThinReadingMindMapProps = {
  activeNodeId: string;
  document: ThinReadingDocument;
  maxVisibleDepth: number;
  onSelectNode: (nodeId: string) => void;
};

type MindMapBranchProps = {
  activeNodeId: string;
  collapsedNodeIds: ReadonlySet<string>;
  document: ThinReadingDocument;
  maxVisibleDepth: number;
  node: ThinReadingNode;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleNode: (nodeId: string) => void;
  path: ReadonlySet<string>;
  relativeDepth: number;
};

export function normalizeMindMapMarkdown(value: string) {
  return value
    .replace(/\\\((.+?)\\\)/gs, (_match, expression: string) => `$${expression}$`)
    .replace(/\\\[(.+?)\\\]/gs, (_match, expression: string) => `$$${expression}$$`)
    .replace(/`([^`\n]+)`/g, (match, expression: string) => (
      /(?:\\[a-z]+|[_^{}]|[=<>]|\b(?:sum|prod|frac|sqrt)\b)/i.test(expression)
        ? `$${expression}$`
        : match
    ));
}

function MindMapMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children: label }) => <span>{label}</span>,
        p: ({ children: paragraph }) => <span>{paragraph}</span>
      }}
      rehypePlugins={[rehypeKatex]}
      remarkPlugins={[remarkGfm, remarkMath]}
    >
      {normalizeMindMapMarkdown(children)}
    </ReactMarkdown>
  );
}

function evidenceCount(node: ThinReadingNode) {
  return node.evidence.paperEvidenceSpans?.length ?? node.evidence.paperEvidence.length;
}

function MindMapBranch({
  activeNodeId,
  collapsedNodeIds,
  document,
  maxVisibleDepth,
  node,
  onDragEnd,
  onDragStart,
  onSelectNode,
  onToggleNode,
  path,
  relativeDepth
}: MindMapBranchProps) {
  const nextPath = new Set(path).add(node.id);
  const children = node.childIds.flatMap((childId) => {
    const child = document.nodes[childId];
    return child && child.depth <= maxVisibleDepth && !path.has(child.id) ? [child] : [];
  });
  const expanded = !collapsedNodeIds.has(node.id);
  const horizontal = relativeDepth < 2;
  const count = evidenceCount(node);
  const showSummary = node.summary.trim() && node.summary.trim() !== node.title.trim();

  return (
    <div
      className={`thin-reading__mindmap-branch ${horizontal ? "is-horizontal" : "is-vertical"}`}
      data-mindmap-depth={node.depth}
      data-mindmap-node-id={node.id}
    >
      <article
        className={`thin-reading__mindmap-node ${node.id === activeNodeId ? "is-active" : ""}`}
        draggable
        onDragEnd={onDragEnd}
        onDragStart={(event) => onDragStart(event, node.id)}
      >
        <div className="thin-reading__mindmap-node-heading">
          {children.length > 0 ? (
            <button
              aria-expanded={expanded}
              aria-label={`${expanded ? "收起" : "展开"}：${node.title}`}
              className="thin-reading__mindmap-toggle"
              onClick={() => onToggleNode(node.id)}
              type="button"
            >
              <span aria-hidden="true">{expanded ? "−" : "+"}</span>
            </button>
          ) : <span aria-hidden="true" className="thin-reading__mindmap-leaf">•</span>}
          <button className="thin-reading__mindmap-title" onClick={() => onSelectNode(node.id)} type="button">
            <MindMapMarkdown>{node.title}</MindMapMarkdown>
          </button>
          {count > 0 ? <span className="thin-reading__mindmap-evidence">{count} 条证据</span> : null}
        </div>
        {showSummary ? (
          <div className="thin-reading__mindmap-summary">
            <MindMapMarkdown>{node.summary}</MindMapMarkdown>
          </div>
        ) : null}
      </article>
      {expanded && children.length > 0 ? (
        <div className={`thin-reading__mindmap-children ${horizontal ? "is-next-column" : "is-below"}`}>
          {children.map((child) => (
            <MindMapBranch
              activeNodeId={activeNodeId}
              collapsedNodeIds={collapsedNodeIds}
              document={document}
              key={child.id}
              maxVisibleDepth={maxVisibleDepth}
              node={child}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onSelectNode={onSelectNode}
              onToggleNode={onToggleNode}
              path={nextPath}
              relativeDepth={relativeDepth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ThinReadingMindMap({
  activeNodeId,
  document,
  maxVisibleDepth,
  onSelectNode
}: ThinReadingMindMapProps) {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [draggedNodeId, setDraggedNodeId] = useState<string>();
  const [splitRootId, setSplitRootId] = useState<string>();
  const root = document.nodes[document.rootNodeId];
  const splitRoot = splitRootId ? document.nodes[splitRootId] : undefined;

  useEffect(() => {
    setCollapsedNodeIds(new Set());
    setDraggedNodeId(undefined);
    setSplitRootId(undefined);
  }, [document.artifactId]);

  useEffect(() => {
    if (splitRootId && !document.nodes[splitRootId]) setSplitRootId(undefined);
  }, [document.nodes, splitRootId]);

  const branchProps = useMemo(() => ({
    activeNodeId,
    collapsedNodeIds,
    document,
    maxVisibleDepth,
    onDragEnd: () => setDraggedNodeId(undefined),
    onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-liteasy-thin-reading-node", nodeId);
      event.dataTransfer.setData("text/plain", nodeId);
      setDraggedNodeId(nodeId);
    },
    onSelectNode,
    onToggleNode: (nodeId: string) => setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    }),
    path: new Set<string>()
  }), [activeNodeId, collapsedNodeIds, document, maxVisibleDepth, onSelectNode]);

  function acceptSplitDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const nodeId = event.dataTransfer.getData("application/x-liteasy-thin-reading-node") ||
      event.dataTransfer.getData("text/plain") || draggedNodeId;
    if (nodeId && document.nodes[nodeId]) setSplitRootId(nodeId);
    setDraggedNodeId(undefined);
  }

  if (!root) return <div className="thin-reading__mindmap-empty">暂无可展示的薄读节点。</div>;

  return (
    <div className={`thin-reading__mindmap-workspace ${splitRoot ? "has-split" : ""}`}>
      <div className="thin-reading__mindmap-panes">
        <section aria-label="完整思维导图" className="thin-reading__mindmap-pane">
          <div className="thin-reading__mindmap-pane-heading">
            <strong>完整导图</strong>
            <span>前两级向右展开，第三级起在父节点下方单列排列</span>
          </div>
          <div className="thin-reading__mindmap-scroll" data-testid="mindmap-primary-scroll">
            <div className="thin-reading__mindmap-tree">
              <MindMapBranch {...branchProps} node={root} relativeDepth={0} />
            </div>
          </div>
        </section>
        {splitRoot ? (
          <section aria-label={`对照阅读：${splitRoot.title}`} className="thin-reading__mindmap-pane is-split">
            <div className="thin-reading__mindmap-pane-heading">
              <div>
                <strong>对照阅读</strong>
                <span>{splitRoot.title}</span>
              </div>
              <button aria-label="关闭对照阅读" onClick={() => setSplitRootId(undefined)} title="关闭对照阅读" type="button">
                <DismissRegular aria-hidden="true" />
              </button>
            </div>
            <div className="thin-reading__mindmap-scroll" data-testid="mindmap-split-scroll">
              <div className="thin-reading__mindmap-tree is-copy">
                <MindMapBranch {...branchProps} node={splitRoot} relativeDepth={0} />
              </div>
            </div>
          </section>
        ) : null}
      </div>
      <div
        aria-label="拖到此处创建对照分栏"
        className={`thin-reading__mindmap-dropzone ${draggedNodeId ? "is-ready" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={acceptSplitDrop}
        role="region"
      >
        <span>拖到这里<br />创建对照</span>
      </div>
    </div>
  );
}
