import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { ExtensionActions } from "../extensions/ExtensionActions";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { BoardLayoutTools } from "./BoardLayoutTools";
import { useVisiblePlacements } from "./useVisiblePlacements";
import { BlockComposer } from "../visual-blocks/BlockComposer";
import type { ExtensionPackagesModel } from "../extensions/useExtensionPackages";
import { BlockAppearanceEditor } from "../visual-blocks/BlockAppearanceEditor";
import { useBlockPresentation } from "../visual-blocks/useBlockPresentation";
import { useCanvasNavigation } from "./useCanvasNavigation";
import type { ResolvedObject } from "../objects/objectResolver";
import {
  useRef,
  useMemo,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactElement,
} from "react";
import {
  Button,
  Checkbox,
  Input,
  Textarea,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  DismissRegular,
  ArrowMoveRegular,
  AddRegular,
  LibraryRegular,
  LinkRegular,
  ChatRegular,
  SettingsRegular,
  BoardRegular,
  ZoomInRegular,
  ZoomOutRegular,
  ArrowExpandRegular,
  FolderOpenRegular,
  SaveRegular,
  SaveCopyRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import {
  connectionPath,
  connectionPoint,
  canvasColor,
  type BoardFileBinding,
} from "./boardFileFormat";
import { ObjectPlacementCard } from "./ObjectPlacementCard";
import { BOARD_PLACEMENT_MIME, readPlacementDrag } from "./boardPlacementDrag";
import { ObjectDetails } from "../object-surface/ObjectSurface";
import {
  refOf,
  objectText,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
  type BoardSide,
  type BoardConnection,
} from "../objects/object.types";
import {
  makeObjectTransfer,
  readObjectTransfer,
  writeObjectTransfer,
} from "../object-transfer/objectTransfer";
import type { ObjectRepository } from "../objects/objectRepository";
import { subscribeObjectStorage } from "../objects/objectStorage";
import type { ContextRef, ContextSnapshot } from "../context/objectContext";
import { AssistantMarkdown } from "../assistant/AssistantMarkdown";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import "./objectWorkbench.css";
export type WorkbenchViewModel = {
  extensions?: ExtensionPackagesModel;
  opened?: ResolvedObject;
  openLink(link: string): Promise<void>;
  closeOpened(): void;
  importLegacyArtifacts(): Promise<unknown>;
  contextTitle(ref: ContextRef): string;
  repository: ObjectRepository;
  visible: boolean;
  setVisible(value: boolean): void;
  objects: ObjectEnvelope[];
  board?: ObjectEnvelope;
  placements: Placement[];
  tray: Array<{ ref: ContextRef; pinned: boolean }>;
  setTray: Dispatch<
    SetStateAction<Array<{ ref: ContextRef; pinned: boolean }>>
  >;
  preview?: ContextSnapshot;
  answer?: { text: string };
  status: string;
  busy: boolean;
  setStatus(value: string): void;
  selectBoard(object: ObjectEnvelope): Promise<void>;
  createBoard(title: string): Promise<unknown>;
  createNote(text: string, position?: Placement["position"]): Promise<unknown>;
  place(refs: ObjectRef[]): Promise<unknown>;
  removePlacement(id: string): Promise<unknown>;
  restoreLayout?(direction: "undo" | "redo"): Promise<unknown>;
  move(placement: Placement, position: Placement["position"], selection?: string[]): Promise<unknown>;
  resize(
    placement: Placement,
    geometry: Pick<Placement, "position" | "size">,
  ): Promise<unknown>;
  editPlacement(placement: Placement, text: string, structured?: import("../objects/visualBlock.types").StructuredBlock): Promise<unknown>;
  drop(data: DataTransfer): Promise<void>;
  addToTray(refs: ContextRef[]): void;
  previewContext(): Promise<void>;
  submit(question: string, systemPrompt?: string): Promise<void>;
  cancel(): void;
  saveAnswer(): Promise<unknown>;
  openSource(object: ObjectEnvelope): Promise<ObjectEnvelope | undefined>;
  refresh(): Promise<void>;
  boardFile?: BoardFileBinding;
  fileBusy?: boolean;
  chooseBoardFile?(): Promise<void>;
  saveBoardFile?(choose?: boolean): Promise<void>;
  exportBoardBundle?(): Promise<Blob>;
  connect?(
    from: Placement,
    fromSide: BoardSide,
    to: Placement,
    toSide: BoardSide,
  ): Promise<unknown>;
  removeConnection?(edgeId: string): Promise<unknown>;
};
export function ObjectWorkbench({ model }: { model: WorkbenchViewModel }) {
  const boardAppearance = useBlockPresentation(model.repository, model.board?.objectId);
  useEffect(() => {
    if (!model.visible) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [model.visible]);
  const [panel, setPanel] = useState<
    "boards" | "note" | "library" | "relations" | "context" | "view" | "components"
  >();
  const [zoom, setZoom] = useState(1);
  const [layerPage, setLayerPage] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const actions = useRef(model);
  actions.current = {
    ...model,
    addToTray: (refs) => {
      model.addToTray(refs);
      setPanel("context");
    },
  };
  const previousTraySize = useRef(model.tray.length);
  useEffect(() => {
    if (model.tray.length > previousTraySize.current) setPanel("context");
    previousTraySize.current = model.tray.length;
  }, [model.tray.length]);
  const [selected, setSelected] = useState<string[]>([]);
  const [newCard, setNewCard] = useState<string>();
  const selection = useRef(selected); selection.current = selected;
  const visiblePlacements = useVisiblePlacements(model.placements, viewport, zoom, selected, model.visible);
  const navigation = useCanvasNavigation({ viewport, canvas, zoom, setZoom, visible: model.visible, boardId: model.board?.objectId,
    placements: model.placements, selected, setSelected, create: async (position) => {
      const before = new Set(model.placements.map((p) => p.placementId));
      await model.createNote("新笔记", position);
      requestAnimationFrame(() => {
        if (actions.current.board?.objectId !== model.board?.objectId && model.board) return;
        const created = actions.current.placements.find((p) => !before.has(p.placementId));
        if (created) { setSelected([created.placementId]); setNewCard(created.placementId); }
      });
    },
    remove: model.removePlacement, error: (failure) => model.setStatus(String(failure)) });
  const [edges, setEdges] = useState<
    Array<BoardConnection & { semantic?: boolean }>
  >([]);
  const [relationsVersion, setRelationsVersion] = useState(0);
  useEffect(() => subscribeObjectStorage(model.repository.scopeId, (keys) => {
    if (!keys || keys.some((key) => key.startsWith("relation/") || key.startsWith(`edge/${model.board?.objectId}/`))) {
      setRelationsVersion((value) => value + 1);
    }
  }), [model.repository, model.board?.objectId]);
  const [connection, setConnection] = useState<{
    from: Placement;
    side: BoardSide;
    point?: { x: number; y: number };
  }>();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const connectionActions = useMemo(() => ({
    active: !!connection,
    start(from: Placement, side: BoardSide) {
      const next = { from, side };
      connectionRef.current = next;
      setConnection(next);
      actions.current.setStatus("拖到另一张卡片的连接点；也可点击目标连接点。Esc 取消。");
    },
    finish(to: Placement, toSide: BoardSide) {
      const start = connectionRef.current;
      if (!start) {
        this.start(to, toSide);
        return;
      }
      if (start.from.placementId === to.placementId) {
        this.start(to, toSide);
        return;
      }
      connectionRef.current = undefined;
      setConnection(undefined);
      void actions.current
        .connect?.(start.from, start.side, to, toSide)
        .catch((e) => actions.current.setStatus(e.message));
    },
    cancel() {
      connectionRef.current = undefined;
      setConnection(undefined);
    },
  }), [Boolean(connection)]);
  useEffect(() => {
    let active = true;
    const board = model.board;
    if (!board) {
      setEdges([]);
      return;
    }
    void Promise.all([
      model.repository.listEdges(board.objectId),
      model.repository.listBoardRelations(board.objectId),
    ])
      .then(([visual, semantic]) => {
        if (!active) return;
        const lines: Array<BoardConnection & { semantic?: boolean }> = [
          ...visual,
        ];
        const represented = new Set(
          visual.flatMap((edge) => (edge.relationId ? [edge.relationId] : [])),
        );
        for (const relation of semantic) {
          if (represented.has(relation.relationId)) continue;
          const from = model.placements.find(
            (p) => JSON.stringify(p.ref) === JSON.stringify(relation.from),
          );
          const to = model.placements.find(
            (p) => JSON.stringify(p.ref) === JSON.stringify(relation.to),
          );
          if (from && to)
            lines.push({
              edgeId: relation.relationId,
              kind: relation.predicate,
              semantic: true,
              from: from.placementId,
              to: to.placementId,
              label:
                relation.predicate === "references"
                  ? "引用"
                  : relation.predicate === "derived_from"
                    ? "派生"
                    : "关联",
            });
        }
        setEdges(lines);
      })
      .catch((e) => {
        if (active) model.setStatus(e.message);
      });
    return () => {
      active = false;
    };
  }, [model.repository, model.board?.revision, model.placements, relationsVersion]);
  const [link, setLink] = useState("");
  const [systemPrompt, setSystemPrompt] = useState<string>();
  const [question, setQuestion] = useState("");
  const [note, setNote] = useState("");
  const [libraryEditing, setLibraryEditing] = useState<ObjectEnvelope>();
  const [boardTitle, setBoardTitle] = useState("");
  const [details, setDetails] = useState<ObjectEnvelope>();
  const [cards, setCards] = useState<Record<string, ObjectEnvelope | null>>({});
  const port = useObjectWorkbench();
  const cachedCards = useRef(cards);
  cachedCards.current = cards;
  useEffect(() => {
    setSelected([]); setNewCard(undefined);
    connectionRef.current = undefined;
    setConnection(undefined);
    setDetails(undefined);
    setCards({});
  }, [model.repository, model.board?.objectId]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      visiblePlacements.map(async (p) => {
        try {
          const cached = cachedCards.current[p.placementId];
          const object =
            cached?.objectId === p.ref.objectId &&
            cached.revision === p.ref.revision
              ? cached
              : await model.repository.get(p.ref);
          return [p.placementId, object] as const;
        } catch {
          return [p.placementId, null] as const;
        }
      }),
    ).then((pairs) => {
      if (alive)
        setCards(Object.fromEntries(pairs.filter((pair) => pair !== null)));
    });
    return () => {
      alive = false;
    };
  }, [model.repository, visiblePlacements]);
  if (!model.visible) return null;
  const refs = selected.flatMap((id) => {
    const p = model.placements.find((p) => p.placementId === id);
    return p ? [p.ref] : [];
  });
  const error = (e: unknown) =>
    model.setStatus(e instanceof Error ? e.message : String(e));
  const canvasWidth = Math.max(
    360,
    ...model.placements.map((p) => p.position.x + p.size.width + 40),
  );
  const canvasHeight = Math.max(
    360,
    ...model.placements.map((p) => p.position.y + p.size.height + 48),
  );
  function fitView() {
    const host = viewport.current;
    if (!host) return;
    setZoom(
      Math.max(
        0.25,
        Math.min(
          1.5,
          (host.clientWidth - 80) / canvasWidth,
          (host.clientHeight - 64) / canvasHeight,
        ),
      ),
    );
    host.scrollTo?.({ top: 0, left: 0, behavior: "smooth" });
  }
  const panelLabels = {
    components: "组件与扩展",
    boards: "白板",
    note: "笔记",
    library: "内容库",
    relations: "连接",
    context: "对话",
    view: "画布",
  };
  const panelHeader = (
    <header>
      <strong>{panel ? panelLabels[panel] : ""}</strong>
      <Tooltip content="收起工具" relationship="description">
        <Button
          appearance="subtle"
          size="small"
          aria-label="收起工具"
          icon={<DismissRegular />}
          onClick={() => setPanel(undefined)}
        />
      </Tooltip>
    </header>
  );
  function tool(
    id: NonNullable<typeof panel>,
    label: string,
    icon: ReactElement,
  ) {
    return (
      <Tooltip content={label} relationship="description">
        <Button
          appearance={panel === id ? "primary" : "subtle"}
          aria-label={label}
          aria-expanded={panel === id}
          icon={icon}
          onClick={() =>
            setPanel((current) => (current === id ? undefined : id))
          }
        />
      </Tooltip>
    );
  }

  return (
    <section className="object-workbench" aria-label="研究白板">
      <header className="object-workbench-header">
        <span className="object-workbench-title">
          {model.board?.title ?? "研究白板"}
        </span>
        <span className="object-board-file-actions">
          {model.chooseBoardFile ? (
            <Tooltip content="打开白板文件" relationship="description">
              <Button
                size="small"
                appearance="subtle"
                aria-label="打开白板文件"
                icon={<FolderOpenRegular />}
                disabled={model.fileBusy}
                onClick={() => void model.chooseBoardFile?.().catch(error)}
              />
            </Tooltip>
          ) : null}
          {model.saveBoardFile ? (
            <Tooltip
              content={
                model.boardFile
                  ? `保存 ${model.boardFile.name}`
                  : "选择白板存储文件"
              }
              relationship="description"
            >
              <Button
                size="small"
                appearance="subtle"
                aria-label={
                  model.boardFile ? "保存白板文件" : "选择白板存储文件"
                }
                icon={<SaveRegular />}
                disabled={!model.board || model.fileBusy}
                onClick={() => void model.saveBoardFile?.().catch(error)}
              />
            </Tooltip>
          ) : null}
          {model.exportBoardBundle ? <Tooltip content="导出白板与附件" relationship="description"><Button size="small" appearance="subtle" aria-label="导出白板与附件" icon={<ArrowDownloadRegular />} disabled={!model.board || model.busy} onClick={() => void model.exportBoardBundle!().then((blob) => { const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "Liteasy-Canvas.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }).catch(error)} /></Tooltip> : null}
          <Tooltip content="关闭白板" relationship="description">
            <Button
              appearance="subtle"
              size="small"
              type="button"
              aria-label="关闭白板"
              icon={<DismissRegular />}
              onClick={() => {
                setDetails(undefined);
                model.closeOpened();
                model.setVisible(false);
              }}
            />
          </Tooltip>
        </span>
      </header>
      <div
        className={`object-board${showGrid ? " has-grid" : ""}`}
        ref={viewport}
        onKeyDownCapture={navigation.onKeyDownCapture}
        onPointerDownCapture={navigation.onPointerDownCapture}
        onPointerMoveCapture={navigation.onPointerMoveCapture}
        onPointerUpCapture={navigation.onPointerUpCapture}
        onPointerCancelCapture={navigation.onPointerUpCapture}
        onDoubleClick={navigation.onDoubleClick}
        onKeyDown={(event) => {
          navigation.onKeyDown(event);
          if ((event.target as Element).closest("input,textarea,select,[contenteditable=true]")) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            void model.restoreLayout?.(event.shiftKey ? "redo" : "undo").catch(error);
          }
          if (event.shiftKey && event.code === "Digit1") { event.preventDefault(); fitView(); }
          if (event.shiftKey && event.code === "Digit2") { event.preventDefault(); navigation.fitSelection(); }
          if (event.key === "Escape") connectionActions.cancel();
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            void model.saveBoardFile?.(event.shiftKey).catch(error);
          }
        }}
        onPointerMove={(event) => {
          const bounds = canvas.current?.getBoundingClientRect();
          if (connectionRef.current && bounds)
            setConnection({
              ...connectionRef.current,
              point: {
                x: (event.clientX - bounds.left) / zoom,
                y: (event.clientY - bounds.top) / zoom,
              },
            });
        }}
        onPointerDown={(event) => {
          if (
            event.target === event.currentTarget ||
            (event.target as Element).classList.contains("object-board-canvas")
          )
            setSelected([]);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (
            event.dataTransfer.types?.includes(
              "application/x-liteasy-board-connection",
            )
          ) {
            event.dataTransfer.dropEffect = "link";
            const bounds = canvas.current?.getBoundingClientRect();
            if (connectionRef.current && bounds)
              setConnection({
                ...connectionRef.current,
                point: {
                  x: (event.clientX - bounds.left) / zoom,
                  y: (event.clientY - bounds.top) / zoom,
                },
              });
            return;
          }
          event.dataTransfer.dropEffect =
            event.dataTransfer.types.includes(BOARD_PLACEMENT_MIME) &&
            !event.ctrlKey &&
            !event.metaKey
              ? "move"
              : "copy";
          const host = event.currentTarget;
          const bounds = host.getBoundingClientRect();
          // Continue dragging/resizing on the scrollable canvas, even outside its
          // initially visible area. The canvas is not bounded by a dock panel.
          const edge = 36;
          host.scrollBy?.({
            left:
              event.clientX > bounds.right - edge
                ? 18
                : event.clientX < bounds.left + edge
                  ? -18
                  : 0,
            top:
              event.clientY > bounds.bottom - edge
                ? 18
                : event.clientY < bounds.top + edge
                  ? -18
                  : 0,
          });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (
            e.dataTransfer.types?.includes(
              "application/x-liteasy-board-connection",
            )
          ) {
            connectionActions.cancel();
            return;
          }
          const dragged = readPlacementDrag(e.dataTransfer);
          const placement =
            dragged?.boardId === model.board?.objectId
              ? model.placements.find(
                  (item) => item.placementId === dragged?.placementId,
                )
              : undefined;
          const bounds = canvas.current?.getBoundingClientRect();
          if (dragged && placement && bounds && !e.ctrlKey && !e.metaKey) {
            const scale = bounds.width / (canvasWidth + 1200) || 1;
            void model
              .move(placement, {
                x: Math.max(
                  0,
                  (e.clientX - bounds.left) / scale -
                    Math.max(
                      0,
                      Math.min(placement.size.width, dragged.offsetX),
                    ),
                ),
                y: Math.max(
                  0,
                  (e.clientY - bounds.top) / scale -
                    Math.max(
                      0,
                      Math.min(placement.size.height, dragged.offsetY),
                    ),
                ),
              })
              .catch(error);
            return;
          }
          void model.drop(e.dataTransfer).catch(error);
        }}
        onPaste={(e) => {
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return;
          e.preventDefault();
          void model.drop(e.clipboardData).catch(error);
        }}
        tabIndex={0}
        aria-label="白板卡片区域"
      >
        <div
          className="object-board-world"
          style={{
            width: Math.max((canvasWidth + 1200) * zoom + 80, 1),
            height: Math.max((canvasHeight + 1200) * zoom + 64, 1),
          }}
        >
          <div
            ref={canvas}
            className="object-board-canvas"
            style={{
              width: canvasWidth + 1200,
              height: canvasHeight + 1200,
              transform: `scale(${zoom})`,
            }}
          >
            {navigation.marquee ? <div className="canvas-selection" style={navigation.marquee} /> : null}
            <svg
              className="object-board-edges"
              aria-label="白板关联"
              width="100%"
              height="100%"
            >
              <defs>
                <marker
                  id="object-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L8,4 L0,8" fill="context-stroke" />
                </marker>
              </defs>
              {edges.filter((edge) => visiblePlacements.some((p) => p.placementId === edge.from || p.placementId === edge.to)).slice(0, 400).map((edge) => {
                const from = model.placements.find(
                  (p) => p.placementId === edge.from,
                );
                const to = model.placements.find(
                  (p) => p.placementId === edge.to,
                );
                if (!from || !to) return null;
                const a = connectionPoint(from, edge.fromSide ?? "bottom");
                const b = connectionPoint(to, edge.toSide ?? "top");
                return (
                  <g key={edge.edgeId} data-edge-id={edge.edgeId} style={{ color: canvasColor(model.boardFile?.document.edges.find((item) => item.id === edge.edgeId)?.color) }}>
                    <path
                      d={connectionPath(
                        a,
                        edge.fromSide ?? "bottom",
                        b,
                        edge.toSide ?? "top",
                        [from, to],
                      )}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.4}
                      markerStart={
                        edge.fromEnd === "arrow"
                          ? "url(#object-arrow)"
                          : undefined
                      }
                      markerEnd={
                        edge.toEnd === "none" ? undefined : "url(#object-arrow)"
                      }
                    />
                    {edge.label ? (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 8}
                        textAnchor="middle"
                      >
                        {edge.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {connection?.point ? (
                <path
                  className="object-connection-preview"
                  d={connectionPath(
                    connectionPoint(connection.from, connection.side),
                    connection.side,
                    connection.point,
                    "top",
                  )}
                  fill="none"
                  stroke="currentColor"
                  strokeDasharray="5 4"
                />
              ) : null}
            </svg>
            {visiblePlacements.map((p) => (
              <ObjectPlacementCard
                key={p.placementId}
                p={p}
                object={cards[p.placementId]}
                canvasNode={model.boardFile?.document.nodes.find((node) => node.id === p.placementId)}
                selected={selected.includes(p.placementId)}
                selection={selection}
                editOnMount={newCard === p.placementId}
                setSelected={setSelected}
                actions={actions}
                setDetails={setDetails}
                blockRegistry={model.extensions?.snapshot.registry}
                connection={model.connect ? connectionActions : undefined}
              />
            ))}
            {!model.placements.length ? (
              <p className="object-empty">
                双击空白处添加卡片，或拖入文献、笔记和图片。
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="object-tool-rail" role="toolbar" aria-label="白板工具">
        {tool("boards", "切换或新建白板", <BoardRegular />)}
        {tool("note", "添加笔记", <AddRegular />)}
        {model.extensions ? tool("components", "添加组件与扩展", <BoardRegular />) : null}
        {tool("library", "已保存的内容", <LibraryRegular />)}
        {tool("relations", "连接内容", <LinkRegular />)}
        {tool("context", "白板对话", <ChatRegular />)}
        {tool("view", "画布设置", <SettingsRegular />)}
      </div>
      <div
        className="object-canvas-navigation"
        role="toolbar"
        aria-label="画布视图"
      >
        <Tooltip content="缩小画布" relationship="description">
          <Button
            size="small"
            appearance="subtle"
            aria-label="缩小画布"
            icon={<ZoomOutRegular />}
            disabled={zoom <= 0.25}
            onClick={() =>
              setZoom((value) =>
                Math.max(0.25, Math.round((value - 0.1) * 100) / 100),
              )
            }
          />
        </Tooltip>
        <button
          type="button"
          className="object-zoom-value"
          aria-label="重置画布缩放"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Tooltip content="放大画布" relationship="description">
          <Button
            size="small"
            appearance="subtle"
            aria-label="放大画布"
            icon={<ZoomInRegular />}
            disabled={zoom >= 2}
            onClick={() =>
              setZoom((value) =>
                Math.min(2, Math.round((value + 0.1) * 100) / 100),
              )
            }
          />
        </Tooltip>
        <Tooltip content="适配全部卡片" relationship="description">
          <Button
            size="small"
            appearance="subtle"
            aria-label="适配全部卡片"
            icon={<ArrowExpandRegular />}
            onClick={fitView}
          />
        </Tooltip>
      </div>
      {panel === "components" && model.extensions ? <div className="object-tool-panel" role="region" aria-label="组件与扩展">{panelHeader}<BlockComposer model={model} /></div> : null}
      {panel === "boards" ? (
        <div className="object-tool-panel" role="region" aria-label="白板列表">
          {panelHeader}
          {model.boardFile ? (
            <div
              className="object-board-file-location"
              title={model.boardFile.path}
            >
              <span>{model.boardFile.name}</span>
              <Tooltip content="另存为白板文件" relationship="description">
                <Button
                  size="small"
                  appearance="subtle"
                  aria-label="另存为白板文件"
                  icon={<SaveCopyRegular />}
                  disabled={model.fileBusy}
                  onClick={() => void model.saveBoardFile?.(true).catch(error)}
                />
              </Tooltip>
            </div>
          ) : null}
          <div className="object-toolbar">
            <select
              aria-label="选择白板"
              value={model.board?.objectId ?? ""}
              onChange={(event) => {
                const object = model.objects.find(
                  (o) => o.objectId === event.target.value,
                );
                if (object) void model.selectBoard(object).catch(error);
              }}
            >
              <option value="" disabled>
                选择白板
              </option>
              {model.objects
                .filter((o) => o.kind === "workspace.board")
                .map((o) => (
                  <option key={o.objectId} value={o.objectId}>
                    {o.title}
                  </option>
                ))}
            </select>
            <Input
              aria-label="新白板名称"
              value={boardTitle}
              onChange={(_, data) => setBoardTitle(data.value)}
              placeholder="新白板名称"
            />
            <Button
              disabled={!boardTitle.trim()}
              onClick={() => void model.createBoard(boardTitle)}
            >
              新建白板
            </Button>
          </div>
        </div>
      ) : null}
      {panel === "note" ? (
        <div className="object-tool-panel" role="region" aria-label="添加笔记">
          {panelHeader}
          <div className="object-toolbar">
            <MarkdownEditor documentKey={libraryEditing?.objectId ?? "new-board-note"} label="笔记内容" value={note} onChange={setNote} />
            <Button
              disabled={!note.trim()}
              onClick={() =>
                void model.createNote(note).then((saved) => {
                  if (saved) setNote("");
                })
              }
            >
              新建笔记
            </Button>
            {libraryEditing?.kind === "content.note" ? (
              <Button
                onClick={() =>
                  void model.repository
                    .editNote(refOf(libraryEditing), note)
                    .then(async (next) => {
                      setLibraryEditing(next);
                      await model.refresh();
                    })
                    .catch(error)
                }
              >
                保存笔记修改
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {panel === "library" ? (
        <div className="object-tool-panel" role="region" aria-label="内容库">
          {panelHeader}
          <div className="object-toolbar">
            <Input
              aria-label="内容链接"
              value={link}
              onChange={(_, data) => setLink(data.value)}
              placeholder="粘贴内容链接"
            />
            <Button onClick={() => void model.openLink(link)}>打开链接</Button>
            <Button onClick={() => void model.importLegacyArtifacts()}>
              读取已有产物
            </Button>
          </div>
          <div>
            {panel === "library" ? (
              <div className="object-library">
                {model.objects
                  .filter((o) => o.kind !== "workspace.board")
                  .map((o) => (
                    <div
                      key={o.objectId}
                      className="object-library-row"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        writeObjectTransfer(
                          event.dataTransfer,
                          makeObjectTransfer([refOf(o)], objectText(o)),
                        );
                      }}
                    >
                      <Tooltip
                        content="拖入白板或对话"
                        relationship="description"
                      >
                        <Button
                          size="small"
                          icon={<ArrowMoveRegular />}
                          aria-label={`拖动${o.title}`}
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "copy";
                            writeObjectTransfer(
                              event.dataTransfer,
                              makeObjectTransfer([refOf(o)], objectText(o)),
                            );
                          }}
                        />
                      </Tooltip>
                      <Button onClick={() => setDetails(o)}>{o.title}</Button>
                      <Button onClick={() => void model.place([refOf(o)])}>
                        加入白板
                      </Button>
                      <Button
                        onClick={() =>
                          void model.repository
                            .copy(refOf(o))
                            .then(() => model.refresh())
                            .catch(error)
                        }
                      >
                        制作独立副本
                      </Button>
                      {o.kind === "content.note" ? (
                        <Button
                          onClick={() => {
                            setPanel("note");
                            setLibraryEditing(o);
                            setNote(o.content.payload.text);
                          }}
                        >
                          编辑笔记
                        </Button>
                      ) : null}
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {panel === "relations" ? (
        <div className="object-tool-panel" role="region" aria-label="连接内容">
          {panelHeader}
          {edges
            .filter((edge) => !edge.semantic)
            .map((edge) => (
              <div className="object-connection-row" key={edge.edgeId}>
                <span>
                  {cards[edge.from]?.title ?? "卡片"} →{" "}
                  {cards[edge.to]?.title ?? "卡片"}
                </span>
                <Tooltip content="移除连接" relationship="description">
                  <Button
                    size="small"
                    appearance="subtle"
                    aria-label="移除连接"
                    icon={<DeleteRegular />}
                    onClick={() =>
                      void model.removeConnection?.(edge.edgeId).catch(error)
                    }
                  />
                </Tooltip>
              </div>
            ))}
          <div className="object-toolbar">
            <Button
              disabled={!refs.length}
              onClick={() => actions.current.addToTray(refs)}
            >
              询问所选内容
            </Button>
            <Button
              disabled={refs.length !== 2}
              onClick={() =>
                void model.repository
                  .relate(refs[0], refs[1], "references")
                  .then(() =>
                    model.setStatus("已建立引用：先选内容引用后选内容。"),
                  )
                  .catch(error)
              }
            >
              建立引用
            </Button>
            <Button
              disabled={refs.length !== 2}
              onClick={() =>
                void model.repository
                  .relate(refs[0], refs[1], "related_to")
                  .then(() => model.setStatus("已建立关联。"))
                  .catch(error)
              }
            >
              建立关联
            </Button>
          </div>
        </div>
      ) : null}
      {panel === "context" ? (
        <div className="object-tool-panel" role="region" aria-label="白板对话">
          {panelHeader}
          <section
            className="object-context"
            aria-label="加入对话的内容"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                const transfer = readObjectTransfer(e.dataTransfer);
                if (transfer) model.addToTray(transfer.refs);
              } catch (e) {
                error(e);
              }
            }}
          >
            <strong>加入对话的内容</strong>
            {model.tray.map((entry, index) => (
              <div key={JSON.stringify(entry.ref)}>
                {model.contextTitle(entry.ref)}
                <Checkbox
                  label="钉住"
                  checked={entry.pinned}
                  onChange={(_, data) =>
                    model.setTray((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, pinned: !!data.checked }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  onClick={() =>
                    model.setTray((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  移除
                </Button>
              </div>
            ))}
            <Button
              disabled={!model.tray.length}
              onClick={() => void model.previewContext()}
            >
              查看实际发送内容
            </Button>
            {model.preview ? (
              <details open>
                <summary>
                  {model.answer ? "本轮实际使用的内容" : "内容预览"}
                </summary>
                {model.preview.entries.map((entry) => (
                  <div key={entry.sha256}>
                    <strong>{entry.title}</strong>
                    <pre>{entry.text}</pre>
                  </div>
                ))}
              </details>
            ) : null}
            <Textarea
              aria-label="针对所选内容提问"
              value={question}
              onChange={(_, data) => setQuestion(data.value)}
              placeholder="针对这些内容提问"
            />
            <GenerationPromptEditor task="assistant" value={systemPrompt} onChange={setSystemPrompt} disabled={model.busy} />
            <Button
              disabled={model.busy || !model.tray.length || !question.trim()}
              onClick={() => {
                void (systemPrompt === undefined ? model.submit(question) : model.submit(question, systemPrompt));
                setSystemPrompt(undefined);
              }}
            >
              提问
            </Button>
            {model.busy ? <Button onClick={model.cancel}>取消</Button> : null}
            {model.answer ? (
              <div>
                <AssistantMarkdown value={model.answer.text} />
                <Button onClick={() => void model.saveAnswer()}>
                  保存为产物
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
      {panel === "view" ? (
        <div className="object-tool-panel" role="region" aria-label="画布设置">
          {panelHeader}
          <Checkbox
            label="显示点阵"
            checked={showGrid}
            onChange={(_, data) => setShowGrid(!!data.checked)}
          />
          <p>单击选中，双击编辑；Shift 单击可多选。拖动卡片移动，Shift 拖动限制方向。</p>
          <p>空格 + 拖动或鼠标中键平移；Ctrl + 滚轮缩放。Shift+1 查看全部，Shift+2 查看所选。</p>
          <p>Delete 移除卡片，Ctrl+Z 撤销布局。卡片工具栏的拖动图标可将内容拖入对话。</p>
          <p>当前缩放 {Math.round(zoom * 100)}%</p>
          <Button onClick={fitView}>适配全部卡片</Button>
          <Button onClick={() => setZoom(1)}>恢复 100%</Button>
          <BoardLayoutTools model={model} selected={selected} />
          <ExtensionActions location="board.context" selection={refs.map((ref) => liteasyPath(model.repository.scopeId, { kind: "object", ref }))} />
          <h4>白板默认字体与布局</h4>
          <BlockAppearanceEditor value={boardAppearance.record.value} onSave={async (value) => { await boardAppearance.save(value); await model.refresh(); }} />
          <h4>所有卡片（包括被遮挡的内容）</h4>
          <div><Button disabled={!layerPage} onClick={() => setLayerPage((page) => page - 1)}>上一页</Button><span>{layerPage + 1} / {Math.max(1, Math.ceil(model.placements.length / 50))}</span><Button disabled={(layerPage + 1) * 50 >= model.placements.length} onClick={() => setLayerPage((page) => page + 1)}>下一页</Button></div>
          <div className="object-layer-list">{model.placements.slice(layerPage * 50, (layerPage + 1) * 50).map((p) => <Button key={p.placementId} appearance={selected.includes(p.placementId) ? "primary" : "subtle"} onClick={() => {
            setSelected([p.placementId]);
            viewport.current?.scrollTo?.({ left: Math.max(0, p.position.x * zoom - 40), top: Math.max(0, p.position.y * zoom - 40), behavior: "smooth" });

          }}>{cards[p.placementId]?.title || `卡片 ${model.placements.indexOf(p) + 1}`}</Button>)}</div>
        </div>
      ) : null}{" "}
      <footer
        role="status"
        className={
          !model.status || /已保存|保存在|保存中/.test(model.status)
            ? "object-status-quiet"
            : ""
        }
      >
        {model.status || "内容保存在本机"}
        {model.status.includes("失败") ? (
          <Button
            onClick={() =>
              port?.explain({
                type: "diagnostic",
                code: "persistence_failed",
                stage: "保存内容",
                message: model.status,
              })
            }
          >
            解释错误
          </Button>
        ) : null}
      </footer>
      {model.opened ? (
        "object" in model.opened ? (
          <ObjectDetails
            object={model.opened.object}
            repository={model.repository}
            onOpen={(object) => {
              model.closeOpened();
              setDetails(object);
            }}
            onClose={model.closeOpened}
            onError={model.setStatus}
          />
        ) : (
          <section className="object-details" aria-label="内容详情">
            <Button onClick={model.closeOpened}>关闭详情</Button>
            {model.opened.state === "unsupported" ? (
              <>
                <h3>{model.opened.title}</h3>
                <p>{model.opened.text}</p>
                <Button
                  onClick={() => {
                    if (model.opened?.state !== "unsupported") return;
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(model.opened.raw, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "research-object.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  导出原始数据
                </Button>
              </>
            ) : (
              <p>
                {"message" in model.opened
                  ? model.opened.message
                  : "内容不可用"}
              </p>
            )}
          </section>
        )
      ) : null}
      {details ? (
        <ObjectDetails
          object={details}
          repository={model.repository}
          onOpen={setDetails}
          onClose={() => setDetails(undefined)}
          onError={model.setStatus}
        />
      ) : null}
    </section>
  );
}
