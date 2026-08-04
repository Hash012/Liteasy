import { DismissRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export type GeneratedMindMapNode = {
  evidenceIds: string[];
  id: string;
  kind: string;
  label: string;
  parentId?: string;
};

type GeneratedMindMapProps = {
  nodes: GeneratedMindMapNode[];
};

type BranchProps = {
  byParent: ReadonlyMap<string | undefined, GeneratedMindMapNode[]>;
  expandedNodeIds: ReadonlySet<string>;
  node: GeneratedMindMapNode;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  path: ReadonlySet<string>;
  relativeDepth: number;
};

function normalizeMathExpression(value: string) {
  return value
    .replace(/^rho(?=[_(^])/i, "\\rho")
    .replace(/_\(([^)]+)\)/g, "_{($1)}")
    .replace(/\^\(([^)]+)\)/g, "^{($1)}");
}

export function normalizeGeneratedMindMapMarkdown(value: string) {
  return value
    .replace(/\\\((.+?)\\\)/gs, (_match, expression: string) => `$${normalizeMathExpression(expression)}$`)
    .replace(/\\\[(.+?)\\\]/gs, (_match, expression: string) => `$$${normalizeMathExpression(expression)}$$`)
    .replace(/`([^`\n]+)`/g, (match, expression: string) => (
      /(?:\\[a-z]+|[_^{}]|[=<>]|\b(?:rho|sum|prod|frac|sqrt)\b)/i.test(expression)
        ? `$${normalizeMathExpression(expression)}$`
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
      {normalizeGeneratedMindMapMarkdown(children)}
    </ReactMarkdown>
  );
}

function collectInitiallyExpanded(
  roots: GeneratedMindMapNode[],
  byParent: ReadonlyMap<string | undefined, GeneratedMindMapNode[]>
) {
  const expanded = new Set<string>();
  const visit = (node: GeneratedMindMapNode, depth: number, path: ReadonlySet<string>) => {
    if (path.has(node.id) || depth >= 2) return;
    const children = byParent.get(node.id) ?? [];
    if (children.length > 0) expanded.add(node.id);
    const nextPath = new Set(path).add(node.id);
    children.forEach((child) => visit(child, depth + 1, nextPath));
  };
  roots.forEach((root) => visit(root, 0, new Set()));
  return expanded;
}

function addRelativeExpansion(
  expanded: Set<string>,
  node: GeneratedMindMapNode,
  byParent: ReadonlyMap<string | undefined, GeneratedMindMapNode[]>
) {
  const children = byParent.get(node.id) ?? [];
  if (children.length > 0) expanded.add(node.id);
  children.forEach((child) => {
    if ((byParent.get(child.id) ?? []).length > 0) expanded.add(child.id);
  });
}

function GeneratedMindMapBranch({
  byParent,
  expandedNodeIds,
  node,
  onDragEnd,
  onDragStart,
  onToggle,
  path,
  relativeDepth
}: BranchProps) {
  if (path.has(node.id)) return null;
  const children = byParent.get(node.id) ?? [];
  const nextPath = new Set(path).add(node.id);
  const expanded = expandedNodeIds.has(node.id);
  const horizontal = relativeDepth < 2;

  return (
    <div
      className={`genui-mindmap-branch ${horizontal ? "is-horizontal" : "is-vertical"} kind-${node.kind}`}
      data-generated-mindmap-depth={relativeDepth}
      data-generated-mindmap-node-id={node.id}
    >
      <article
        className="genui-mindmap-node"
        draggable
        onDragEnd={onDragEnd}
        onDragStart={(event) => onDragStart(event, node.id)}
      >
        <span aria-hidden="true" className={`genui-outline-kind ${node.kind}`} />
        {children.length > 0 ? (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}：${node.label}`}
            className="genui-mindmap-toggle"
            onClick={() => onToggle(node.id)}
            type="button"
          >
            {expanded ? "−" : "+"}
          </button>
        ) : null}
        <div className="genui-mindmap-label"><MindMapMarkdown>{node.label}</MindMapMarkdown></div>
        {node.evidenceIds.length > 0 ? <small>{node.evidenceIds.length} 条证据</small> : null}
      </article>
      {expanded && children.length > 0 ? (
        <div className={`genui-mindmap-children ${horizontal ? "is-next-column" : "is-below"}`}>
          {children.map((child) => (
            <GeneratedMindMapBranch
              byParent={byParent}
              expandedNodeIds={expandedNodeIds}
              key={child.id}
              node={child}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onToggle={onToggle}
              path={nextPath}
              relativeDepth={relativeDepth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GeneratedMindMap({ nodes }: GeneratedMindMapProps) {
  const nodeSignature = nodes.map((node) => `${node.id}:${node.parentId ?? "root"}`).join("|");
  const { byParent, nodesById, roots } = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.id));
    const nextByParent = new Map<string | undefined, GeneratedMindMapNode[]>();
    nodes.forEach((node) => {
      const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : undefined;
      const siblings = nextByParent.get(parentId) ?? [];
      siblings.push(node);
      nextByParent.set(parentId, siblings);
    });
    return {
      byParent: nextByParent,
      nodesById: new Map(nodes.map((node) => [node.id, node])),
      roots: nextByParent.get(undefined) ?? []
    };
  }, [nodes]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => collectInitiallyExpanded(roots, byParent)
  );
  const [draggedNodeId, setDraggedNodeId] = useState<string>();
  const [splitRootId, setSplitRootId] = useState<string>();
  const splitRoot = splitRootId ? nodesById.get(splitRootId) : undefined;

  useEffect(() => {
    setExpandedNodeIds(collectInitiallyExpanded(roots, byParent));
    setDraggedNodeId(undefined);
    setSplitRootId(undefined);
  }, [nodeSignature]);

  const branchProps = {
    byParent,
    expandedNodeIds,
    onDragEnd: () => setDraggedNodeId(undefined),
    onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-liteasy-generated-mindmap-node", nodeId);
      event.dataTransfer.setData("text/plain", nodeId);
      setDraggedNodeId(nodeId);
    },
    onToggle: (nodeId: string) => setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    }),
    path: new Set<string>()
  };

  function acceptSplitDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const nodeId = event.dataTransfer.getData("application/x-liteasy-generated-mindmap-node") ||
      event.dataTransfer.getData("text/plain") || draggedNodeId;
    const node = nodeId ? nodesById.get(nodeId) : undefined;
    if (node) {
      setSplitRootId(node.id);
      setExpandedNodeIds((current) => {
        const next = new Set(current);
        addRelativeExpansion(next, node, byParent);
        return next;
      });
    }
    setDraggedNodeId(undefined);
  }

  return (
    <div className={`genui-mindmap-workspace ${splitRoot ? "has-split" : ""}`}>
      <div className="genui-mindmap-panes">
        <section aria-label="完整生成思维导图" className="genui-mindmap-pane">
          <div className="genui-mindmap-pane-heading">
            <strong>完整导图</strong>
            <span>前两级向右展开，第三级起在父节点下方单列排列</span>
          </div>
          <div className="genui-mindmap-scroll" data-testid="generated-mindmap-primary-scroll">
            <div className="genui-mindmap-tree">
              {roots.map((root) => (
                <GeneratedMindMapBranch {...branchProps} key={root.id} node={root} relativeDepth={0} />
              ))}
            </div>
          </div>
        </section>
        {splitRoot ? (
          <section aria-label={`生成思维导图对照阅读：${splitRoot.label}`} className="genui-mindmap-pane is-split">
            <div className="genui-mindmap-pane-heading">
              <div>
                <strong>对照阅读</strong>
                <span>{splitRoot.label}</span>
              </div>
              <button aria-label="关闭生成思维导图对照阅读" onClick={() => setSplitRootId(undefined)} title="关闭对照阅读" type="button">
                <DismissRegular aria-hidden="true" />
              </button>
            </div>
            <div className="genui-mindmap-scroll" data-testid="generated-mindmap-split-scroll">
              <div className="genui-mindmap-tree is-copy">
                <GeneratedMindMapBranch {...branchProps} node={splitRoot} relativeDepth={0} />
              </div>
            </div>
          </section>
        ) : null}
      </div>
      <div
        aria-label="拖到此处创建生成思维导图对照分栏"
        className={`genui-mindmap-dropzone ${draggedNodeId ? "is-ready" : ""}`}
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
