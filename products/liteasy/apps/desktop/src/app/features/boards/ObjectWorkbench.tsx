import type { ResolvedObject } from "../objects/objectResolver";
import { ObjectAssetImage } from "../object-surface/ObjectAssetImage";
import {
  memo,
  useRef,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Button,
  Checkbox,
  Input,
  Textarea,
  Tooltip,
} from "@fluentui/react-components";
import { DismissRegular, ArrowMoveRegular } from "@fluentui/react-icons";
import { ObjectSurface, ObjectDetails } from "../object-surface/ObjectSurface";
import {
  refOf,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
} from "../objects/object.types";
import { readObjectTransfer } from "../object-transfer/objectTransfer";
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
  const actions = useRef(model);
  actions.current = model;
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  return (
    <section className="object-workbench" aria-label="研究白板">
      <header>
        <strong>研究白板</strong>
        <Tooltip content="关闭白板" relationship="description">
          <Button
            aria-label="关闭白板"
            icon={<DismissRegular />}
            onClick={() => model.setVisible(false)}
          />
        </Tooltip>
      </header>
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
      <div className="object-toolbar">
        <Button disabled={!refs.length} onClick={() => model.addToTray(refs)}>
          询问所选内容
        </Button>
        <Button
          disabled={refs.length !== 2}
          onClick={() =>
            void model.repository
              .relate(refs[0], refs[1], "references")
              .then(() => model.setStatus("已建立引用：先选内容引用后选内容。"))
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
      <div
        className="object-board"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
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
          className="object-board-canvas"
          style={{
            minHeight: Math.max(
              350,
              ...model.placements.map((p) => p.position.y + 240),
            ),
            minWidth: Math.max(
              600,
              ...model.placements.map((p) => p.position.x + p.size.width + 20),
            ),
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
      <details onToggle={(event) => setLibraryOpen(event.currentTarget.open)}>
        <summary>已保存的内容</summary>
        {libraryOpen ? (
          <div className="object-library">
            {model.objects
              .filter((o) => o.kind !== "workspace.board")
              .map((o) => (
                <div key={o.objectId}>
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
                        setDetails(o);
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
      </details>
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
        {details?.kind === "content.note" ? (
          <Button
            onClick={() =>
              void model.repository
                .editNote(refOf(details), note)
                .then(async (next) => {
                  setDetails(next);
                  await model.refresh();
                })
                .catch(error)
            }
          >
            保存笔记修改
          </Button>
        ) : null}
      </div>
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
                    i === index ? { ...item, pinned: !!data.checked } : item,
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
            <Button onClick={() => void model.saveAnswer()}>保存为产物</Button>
          </div>
        ) : null}
      </section>
      <footer role="status">
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
          <section className="object-details">
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

const ObjectPlacementCard = memo(function ObjectPlacementCard({
  p,
  object,
  selected,
  setSelected,
  actions,
  setDetails,
}: {
  p: Placement;
  object?: ObjectEnvelope | null;
  selected: boolean;
  setSelected: Dispatch<SetStateAction<string[]>>;
  actions: { current: WorkbenchViewModel };
  setDetails: Dispatch<SetStateAction<ObjectEnvelope | undefined>>;
}) {
  const error = (e: unknown) =>
    actions.current.setStatus(e instanceof Error ? e.message : String(e));
  return (
    <div
      className="object-placement"
      data-placement-id={p.placementId}
      style={{
        left: p.position.x,
        top: p.position.y,
        width: p.size.width,
        minHeight: p.size.height,
      }}
    >
      <div className="object-toolbar">
        <Checkbox
          aria-label={`选择${object?.title ?? "卡片"}`}
          checked={selected}
          onChange={(_, data) =>
            setSelected((current) =>
              data.checked
                ? [...current, p.placementId]
                : current.filter((id) => id !== p.placementId),
            )
          }
        />
        <Tooltip content="拖动位置；方向键移动卡片" relationship="description">
          <Button
            size="small"
            aria-label="移动卡片"
            icon={<ArrowMoveRegular />}
            onKeyDown={(event) => {
              const delta: Record<string, number[]> = {
                ArrowLeft: [-20, 0],
                ArrowRight: [20, 0],
                ArrowUp: [0, -20],
                ArrowDown: [0, 20],
              };
              const d = delta[event.key];
              if (d) {
                event.preventDefault();
                void actions.current.move(p, {
                  x: Math.max(0, p.position.x + d[0]),
                  y: Math.max(0, p.position.y + d[1]),
                });
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              const button = event.currentTarget;
              const x = event.clientX,
                y = event.clientY;
              button.setPointerCapture(event.pointerId);
              const up = (end: PointerEvent) => {
                button.removeEventListener("pointerup", up);
                if (Math.abs(end.clientX - x) + Math.abs(end.clientY - y) > 3)
                  void actions.current.move(p, {
                    x: Math.max(0, p.position.x + end.clientX - x),
                    y: Math.max(0, p.position.y + end.clientY - y),
                  });
              };
              button.addEventListener("pointerup", up, { once: true });
            }}
          />
        </Tooltip>
        <Button
          size="small"
          onClick={() => void actions.current.removePlacement(p.placementId)}
        >
          移除卡片
        </Button>
      </div>
      {object?.assets.map((asset) => (
        <ObjectAssetImage
          key={asset.assetId}
          repository={actions.current.repository}
          assetId={asset.assetId}
        />
      ))}
      {object ? (
        <ObjectSurface
          object={object}
          onAdd={(ref) => actions.current.addToTray([ref])}
          onSource={() =>
            void actions.current
              .openSource(object)
              .then((source) => source && setDetails(source))
              .catch(error)
          }
          onDetails={() => setDetails(object)}
          onError={(message) => actions.current.setStatus(message)}
        />
      ) : (
        <p>{object === null ? "内容不可用，引用仍保留。" : "正在读取内容…"}</p>
      )}
    </div>
  );
});
