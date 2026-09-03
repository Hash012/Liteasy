import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Tooltip } from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  DismissRegular,
  ImageAddRegular,
  LinkRegular
} from "@fluentui/react-icons";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent
} from "react";
import { PdfAnnotationMarkdown } from "../PdfAnnotationMarkdown";
import {
  appendPdfWhiteboardNode,
  createPdfWhiteboardEdge,
  createPdfWhiteboardNode,
  nextPdfWhiteboardNodePosition
} from "./pdfWhiteboardModel";
import type {
  PdfWhiteboardDocument,
  PdfWhiteboardNode,
  PdfWhiteboardPoint,
  PdfWhiteboardPdfSource,
  PdfWhiteboardViewport
} from "./pdfWhiteboard.types";
import "./pdfWhiteboard.css";

export const pdfWhiteboardDragMime = "application/x-liteasy-whiteboard-node";
const maxImportedImageBytes = 8 * 1024 * 1024;

export type PdfWhiteboardDraggedExcerpt = {
  kind: "markdown";
  markdown: string;
  source?: PdfWhiteboardPdfSource;
};

type PdfWhiteboardProps = {
  document: PdfWhiteboardDocument;
  onChange: (document: PdfWhiteboardDocument) => void;
  onClose: () => void;
  paperTitle: string;
};

type WhiteboardNodeData = {
  item: PdfWhiteboardNode;
  onChangeMarkdown: (nodeId: string, markdown: string) => void;
  onDelete: (nodeId: string) => void;
  onResize: (nodeId: string, width: number, height: number) => void;
};

type WhiteboardFlowNode = Node<WhiteboardNodeData, "whiteboard">;

function PdfWhiteboardNodeView({ data, selected }: NodeProps<WhiteboardFlowNode>) {
  const { item } = data;
  const [editing, setEditing] = useState(item.kind === "markdown" && !item.content.markdown);

  return (
    <article
      aria-label={item.kind === "image" ? `白板图片：${item.content.alt}` : "白板节点"}
      className={`pdf-whiteboard-node is-${item.kind} ${selected ? "is-selected" : ""}`}
    >
      <NodeResizer
        isVisible={selected}
        minHeight={80}
        minWidth={150}
        onResizeEnd={(_, size) => data.onResize(item.id, size.width, size.height)}
      />
      <Handle aria-label="连接到此节点" position={Position.Left} type="target" />
      <Handle aria-label="从此节点建立连接" position={Position.Right} type="source" />
      <header className="pdf-whiteboard-node-header">
        <span>
          {item.kind === "markdown" ? "文字" : item.kind === "image" ? "图片" :
            item.kind === "literature" ? "文献" : item.content.title}
          {item.source?.type === "pdf" && item.source.page ? ` · P${item.source.page}` : ""}
        </span>
        <button
          aria-label="删除白板节点"
          className="nodrag nopan"
          onClick={() => data.onDelete(item.id)}
          title="删除节点"
          type="button"
        >
          <DeleteRegular />
        </button>
      </header>
      {item.kind === "markdown" ? (
        editing ? (
          <textarea
            aria-label="白板文字内容"
            autoFocus
            className="nodrag nowheel"
            onBlur={() => setEditing(false)}
            onChange={(event) => data.onChangeMarkdown(item.id, event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="输入想法、摘录或 Markdown…"
            value={item.content.markdown}
          />
        ) : (
          <button
            aria-label="编辑白板文字"
            className="pdf-whiteboard-markdown nodrag nopan"
            onDoubleClick={() => setEditing(true)}
            type="button"
          >
            <PdfAnnotationMarkdown emptyLabel="双击输入文字" value={item.content.markdown} />
          </button>
        )
      ) : item.kind === "image" ? (
        <img alt={item.content.alt} draggable={false} src={item.content.dataUrl} />
      ) : item.kind === "literature" ? (
        <div className="pdf-whiteboard-literature-card">
          <strong>{item.content.title}</strong>
          <small>{item.content.literatureId ?? "本地文献链接"}</small>
        </div>
      ) : (
        <div className="pdf-whiteboard-extension-card">
          <strong>{item.content.title}</strong>
          <small>扩展渲染器：{item.content.renderer}</small>
        </div>
      )}
    </article>
  );
}

const nodeTypes = { whiteboard: PdfWhiteboardNodeView };

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("无法读取图片。"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("无法读取图片。")));
    reader.readAsDataURL(file);
  });
}

function parseDraggedExcerpt(serialized: string): PdfWhiteboardDraggedExcerpt | null {
  try {
    const value = JSON.parse(serialized) as Partial<PdfWhiteboardDraggedExcerpt>;
    return value.kind === "markdown" && typeof value.markdown === "string"
      ? { kind: "markdown", markdown: value.markdown, source: value.source }
      : null;
  } catch {
    return null;
  }
}

export function PdfWhiteboard({ document, onChange, onClose, paperTitle }: PdfWhiteboardProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const flowRef = useRef<ReactFlowInstance<WhiteboardFlowNode, Edge> | null>(null);
  const [message, setMessage] = useState("拖入文字或图片，也可以粘贴截图。");

  function commit(next: Partial<Pick<PdfWhiteboardDocument, "edges" | "nodes" | "viewport">>) {
    const current = documentRef.current;
    const updated: PdfWhiteboardDocument = {
      ...current,
      ...next,
      updatedAt: new Date().toISOString()
    };
    documentRef.current = updated;
    onChange(updated);
  }

  function updateNode(nodeId: string, update: (node: PdfWhiteboardNode) => PdfWhiteboardNode) {
    const current = documentRef.current;
    commit({
      nodes: current.nodes.map((node) => node.id === nodeId ? update(node) : node)
    });
  }

  function deleteNode(nodeId: string) {
    const current = documentRef.current;
    commit({
      edges: current.edges.filter((edge) =>
        edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
      ),
      nodes: current.nodes.filter((node) => node.id !== nodeId)
    });
    setMessage("节点已删除。");
  }

  const nodes = useMemo<WhiteboardFlowNode[]>(() => document.nodes.map((item) => ({
    data: {
      item,
      onChangeMarkdown: (nodeId, markdown) => updateNode(nodeId, (node) => node.kind === "markdown"
        ? {
            ...node,
            content: { markdown },
            updatedAt: new Date().toISOString()
          }
        : node),
      onDelete: deleteNode,
      onResize: (nodeId, width, height) => updateNode(nodeId, (node) => ({
        ...node,
        size: { height, width },
        updatedAt: new Date().toISOString()
      }))
    },
    id: item.id,
    position: item.position,
    style: { height: item.size.height, width: item.size.width },
    type: "whiteboard"
  })), [document]);

  const edges = useMemo<Edge[]>(() => document.edges.map((edge) => ({
    id: edge.id,
    label: edge.label,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: "smoothstep"
  })), [document.edges]);

  function canvasCenterPosition() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || !flowRef.current) {
      return nextPdfWhiteboardNodePosition(documentRef.current.nodes.length);
    }
    return flowRef.current.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }

  function addMarkdown(markdown: string, position = canvasCenterPosition(), source?: PdfWhiteboardPdfSource) {
    const current = documentRef.current;
    const node = createPdfWhiteboardNode({ kind: "markdown", markdown, source }, position);
    const updated = appendPdfWhiteboardNode(current, node);
    documentRef.current = updated;
    onChange(updated);
    setMessage(markdown ? "文字已放入白板。" : "已创建文字节点；拖动边缘锚点可建立连接。");
  }

  async function addImages(files: readonly File[], position: PdfWhiteboardPoint) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const oversized = images.find((file) => file.size > maxImportedImageBytes);
    if (oversized) {
      setMessage(`图片 ${oversized.name || "截图"} 超过 8 MB，未加入白板。`);
      return;
    }
    try {
      const dataUrls = await Promise.all(images.map(readImageFile));
      const nodesToAdd = images.map((file, index) => createPdfWhiteboardNode({
        alt: file.name || "粘贴的截图",
        dataUrl: dataUrls[index],
        kind: "image" as const,
        mimeType: file.type,
        sourceName: file.name || undefined
      }, { x: position.x + index * 28, y: position.y + index * 28 }));
      const current = documentRef.current;
      commit({ nodes: [...current.nodes, ...nodesToAdd] });
      setMessage(`已加入 ${nodesToAdd.length} 张图片。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取图片。");
    }
  }

  function dropPosition(event: Pick<DragEvent<HTMLDivElement>, "clientX" | "clientY">) {
    return flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ??
      nextPdfWhiteboardNodePosition(documentRef.current.nodes.length);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const position = dropPosition(event);
    const draggedExcerpt = parseDraggedExcerpt(event.dataTransfer.getData(pdfWhiteboardDragMime));
    if (draggedExcerpt) {
      addMarkdown(draggedExcerpt.markdown, position, draggedExcerpt.source);
      return;
    }
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (imageFiles.length > 0) {
      void addImages(imageFiles, position);
      return;
    }
    const text = event.dataTransfer.getData("text/plain").trim();
    if (text) addMarkdown(text, position);
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("textarea, input, [contenteditable=true]")) return;
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (images.length > 0) {
      event.preventDefault();
      void addImages(images, canvasCenterPosition());
      return;
    }
    const text = event.clipboardData.getData("text/plain").trim();
    if (text) {
      event.preventDefault();
      addMarkdown(text);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 0) void addImages(files, canvasCenterPosition());
    event.currentTarget.value = "";
  }

  function connect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const current = documentRef.current;
    if (current.edges.some((edge) => edge.sourceNodeId === connection.source &&
      edge.targetNodeId === connection.target)) return;
    commit({
      edges: [...current.edges, createPdfWhiteboardEdge(connection.source, connection.target)]
    });
    setMessage("已连接两个节点。");
  }

  function persistViewport(viewport: Viewport) {
    const nextViewport: PdfWhiteboardViewport = viewport;
    commit({ viewport: nextViewport });
  }

  return (
    <aside
      aria-label="PDF 思考白板"
      className="pdf-whiteboard"
      onPaste={handlePaste}
      tabIndex={0}
    >
      <header className="pdf-whiteboard-header">
        <div>
          <strong>White Board</strong>
          <small title={paperTitle}>{paperTitle}</small>
        </div>
        <Tooltip content="收起白板" relationship="label">
          <Button
            appearance="subtle"
            aria-label="收起 PDF 白板"
            icon={<DismissRegular />}
            onClick={onClose}
            size="small"
          />
        </Tooltip>
      </header>
      <div aria-label="白板工具栏" className="pdf-whiteboard-toolbar" role="toolbar">
        <Button
          appearance="subtle"
          icon={<AddRegular />}
          onClick={() => addMarkdown("")}
          size="small"
        >
          文字
        </Button>
        <Button
          appearance="subtle"
          icon={<ImageAddRegular />}
          onClick={() => fileInputRef.current?.click()}
          size="small"
        >
          图片
        </Button>
        <span><LinkRegular /> 拖动节点锚点连线</span>
        <input
          accept="image/*"
          aria-label="选择白板图片"
          hidden
          multiple
          onChange={handleFileInput}
          ref={fileInputRef}
          type="file"
        />
      </div>
      <div
        aria-label="可拖放的 PDF 白板画布"
        className="pdf-whiteboard-canvas"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleDrop}
        ref={canvasRef}
      >
        {document.nodes.length === 0 ? (
          <div className="pdf-whiteboard-empty" role="note">
            <strong>把想法放在论文旁边</strong>
            <span>创建文字节点，或把文字、图片和截图拖放/粘贴到这里。</span>
          </div>
        ) : null}
        <ReactFlow<WhiteboardFlowNode, Edge>
          defaultViewport={document.viewport}
          deleteKeyCode={["Backspace", "Delete"]}
          edges={edges}
          fitView={!document.viewport && document.nodes.length > 0}
          minZoom={0.25}
          nodeTypes={nodeTypes}
          nodes={nodes}
          onConnect={connect}
          onEdgesDelete={(deleted) => commit({
            edges: documentRef.current.edges.filter((edge) =>
              !deleted.some((item) => item.id === edge.id)
            )
          })}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          onMoveEnd={(_, viewport) => persistViewport(viewport)}
          onNodeDragStop={(_, flowNode) => updateNode(flowNode.id, (node) => ({
            ...node,
            position: flowNode.position,
            updatedAt: new Date().toISOString()
          }))}
          onNodesDelete={(deleted) => {
            const ids = new Set(deleted.map((node) => node.id));
            const current = documentRef.current;
            commit({
              edges: current.edges.filter((edge) =>
                !ids.has(edge.sourceNodeId) && !ids.has(edge.targetNodeId)
              ),
              nodes: current.nodes.filter((node) => !ids.has(node.id))
            });
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#9db0c2" gap={18} size={1} variant={BackgroundVariant.Dots} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <footer aria-live="polite" className="pdf-whiteboard-status">{message}</footer>
    </aside>
  );
}
