import type { ResolvedObject } from "../objects/objectResolver";
import {
  useRef,
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
} from "@fluentui/react-icons";
import { ObjectPlacementCard } from "./ObjectPlacementCard";
import { BOARD_PLACEMENT_MIME, readPlacementDrag } from "./boardPlacementDrag";
import { ObjectDetails } from "../object-surface/ObjectSurface";
import {
  refOf,
  objectText,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
} from "../objects/object.types";
import {
  makeObjectTransfer,
  readObjectTransfer,
  writeObjectTransfer,
} from "../object-transfer/objectTransfer";
import type { ObjectRepository } from "../objects/objectRepository";
import type { ContextRef, ContextSnapshot } from "../context/objectContext";
import { AssistantMarkdown } from "../assistant/AssistantMarkdown";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import "./objectWorkbench.css";
export type WorkbenchViewModel = {
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
  createNote(text: string): Promise<unknown>;
  place(refs: ObjectRef[]): Promise<unknown>;
  removePlacement(id: string): Promise<unknown>;
  move(placement: Placement, position: Placement["position"]): Promise<unknown>;
  resize(
    placement: Placement,
    geometry: Pick<Placement, "position" | "size">,
  ): Promise<unknown>;
  editPlacement(placement: Placement, text: string): Promise<unknown>;
  drop(data: DataTransfer): Promise<void>;
  addToTray(refs: ContextRef[]): void;
  previewContext(): Promise<void>;
  submit(question: string): Promise<void>;
  cancel(): void;
  saveAnswer(): Promise<unknown>;
  openSource(object: ObjectEnvelope): Promise<ObjectEnvelope | undefined>;
  refresh(): Promise<void>;
};
export function ObjectWorkbench({ model }: { model: WorkbenchViewModel }) {
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
    "boards" | "note" | "library" | "relations" | "context" | "view"
  >();
  const [zoom, setZoom] = useState(1);
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
  const [edges, setEdges] = useState<
    Array<{ id: string; from: string; to: string; label: string }>
  >([]);
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
        const lines = visual.map((edge) => ({
          id: edge.edgeId,
          from: edge.from,
          to: edge.to,
          label: edge.label ?? "连线",
        }));
        for (const relation of semantic) {
          const from = model.placements.find(
            (p) => JSON.stringify(p.ref) === JSON.stringify(relation.from),
          );
          const to = model.placements.find(
            (p) => JSON.stringify(p.ref) === JSON.stringify(relation.to),
          );
          if (from && to)
            lines.push({
              id: relation.relationId,
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
  }, [model.repository, model.board?.revision, model.placements, model.status]);
  const [link, setLink] = useState("");
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
    setSelected([]);
    setDetails(undefined);
    setCards({});
  }, [model.repository, model.board?.objectId]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      model.placements.map(async (p) => {
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
  }, [model.repository, model.placements]);
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
      </header>
      <div
        className={`object-board${showGrid ? " has-grid" : ""}`}
        ref={viewport}
        onPointerDown={(event) => {
          if (
            event.target === event.currentTarget ||
            (event.target as Element).classList.contains("object-board-canvas")
          )
            setSelected([]);
        }}
        onDragOver={(event) => {
          event.preventDefault();
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
          const dragged = readPlacementDrag(e.dataTransfer);
          const placement =
            dragged?.boardId === model.board?.objectId
              ? model.placements.find(
                  (item) => item.placementId === dragged?.placementId,
                )
              : undefined;
          const bounds = canvas.current?.getBoundingClientRect();
          if (dragged && placement && bounds && !e.ctrlKey && !e.metaKey) {
            const scale = bounds.width / canvasWidth || 1;
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
            width: Math.max(canvasWidth * zoom + 80, 1),
            height: Math.max(canvasHeight * zoom + 64, 1),
          }}
        >
          <div
            ref={canvas}
            className="object-board-canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              transform: `scale(${zoom})`,
            }}
          >
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
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8" fill="currentColor" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = model.placements.find(
                  (p) => p.placementId === edge.from,
                );
                const to = model.placements.find(
                  (p) => p.placementId === edge.to,
                );
                if (!from || !to) return null;
                const x1 = from.position.x + from.size.width / 2,
                  y1 = from.position.y + from.size.height,
                  x2 = to.position.x + to.size.width / 2,
                  y2 = to.position.y + to.size.height;
                const lane = Math.max(y1, y2) + 24;
                return (
                  <g key={edge.id}>
                    <path
                      d={`M ${x1} ${y1} V ${lane} H ${x2} V ${y2}`}
                      fill="none"
                      stroke="currentColor"
                      markerEnd="url(#object-arrow)"
                    />
                    <text x={(x1 + x2) / 2} y={lane - 6} textAnchor="middle">
                      {edge.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {model.placements.map((p) => (
              <ObjectPlacementCard
                key={p.placementId}
                p={p}
                object={cards[p.placementId]}
                selected={selected.includes(p.placementId)}
                setSelected={setSelected}
                actions={actions}
                setDetails={setDetails}
              />
            ))}
            {!model.placements.length ? (
              <p className="object-empty">
                从论文或回答加入摘录，也可以在这里粘贴文字。
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="object-tool-rail" role="toolbar" aria-label="白板工具">
        {tool("boards", "切换或新建白板", <BoardRegular />)}
        {tool("note", "添加笔记", <AddRegular />)}
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
      {panel === "boards" ? (
        <div className="object-tool-panel" role="region" aria-label="白板列表">
          {panelHeader}
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
            <Textarea
              aria-label="笔记内容"
              value={note}
              onChange={(_, data) => setNote(data.value)}
              placeholder="写一条笔记"
            />
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
            <Button
              disabled={model.busy || !model.tray.length || !question.trim()}
              onClick={() => void model.submit(question)}
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
          <p>当前缩放 {Math.round(zoom * 100)}%</p>
          <Button onClick={fitView}>适配全部卡片</Button>
          <Button onClick={() => setZoom(1)}>恢复 100%</Button>
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
