import {
  memo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
} from "react";
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
  Textarea,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowMoveRegular,
  CheckmarkRegular,
  ChatAddRegular,
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  HistoryRegular,
  LinkRegular,
  SettingsRegular,
  SelectAllOnRegular,
} from "@fluentui/react-icons";
import {
  makeObjectTransfer,
  writeObjectTransfer,
} from "../object-transfer/objectTransfer";
import { ObjectAssetImage } from "../object-surface/ObjectAssetImage";
import { ObjectSurface } from "../object-surface/ObjectSurface";
import {
  objectText,
  objectLink,
  refOf,
  type ObjectEnvelope,
  type Placement,
} from "../objects/object.types";
import type { WorkbenchViewModel } from "./ObjectWorkbench";

type Geometry = Pick<Placement, "position" | "size">;
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const resizeLabels: Record<ResizeDirection, string> = {
  n: "上边",
  ne: "右上角",
  e: "右边",
  se: "右下角",
  s: "下边",
  sw: "左下角",
  w: "左边",
  nw: "左上角",
};
const minimumSize = { width: 220, height: 180 };

export function resizeCardGeometry(
  geometry: Geometry,
  direction: ResizeDirection,
  dx: number,
  dy: number,
): Geometry {
  const left = geometry.position.x;
  const top = geometry.position.y;
  const right = left + geometry.size.width;
  const bottom = top + geometry.size.height;
  const nextLeft = direction.includes("w")
    ? Math.max(0, Math.min(right - minimumSize.width, left + dx))
    : left;
  const nextTop = direction.includes("n")
    ? Math.max(0, Math.min(bottom - minimumSize.height, top + dy))
    : top;
  const nextRight = direction.includes("e")
    ? Math.max(left + minimumSize.width, right + dx)
    : right;
  const nextBottom = direction.includes("s")
    ? Math.max(top + minimumSize.height, bottom + dy)
    : bottom;
  return {
    position: { x: nextLeft, y: nextTop },
    size: { width: nextRight - nextLeft, height: nextBottom - nextTop },
  };
}

export const ObjectPlacementCard = memo(function ObjectPlacementCard({
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
  const cardRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointerId: number;
    direction: ResizeDirection | "move";
    startX: number;
    startY: number;
    scale: number;
    placement: Placement;
    current: Geometry;
  }>();
  const [preview, setPreview] = useState<Geometry>();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const error = (e: unknown) =>
    actions.current.setStatus(e instanceof Error ? e.message : String(e));
  const geometry = preview ?? p;
  const assetCaptions = new Map(
    object
      ? Array.from(
          objectText(object).matchAll(
            /!\[([^\]\n]*)\]\(\s*attachment:([^)]+)\)/g,
          ),
          (match) => [match[2], match[1]],
        )
      : [],
  );

  function begin(
    event: PointerEvent<HTMLElement>,
    direction: ResizeDirection | "move",
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const scale =
      (cardRef.current?.getBoundingClientRect().width ?? p.size.width) /
        p.size.width || 1;
    gesture.current = {
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      scale,
      placement: p,
      current: { position: p.position, size: p.size },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function drag(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.startX) / active.scale;
    const dy = (event.clientY - active.startY) / active.scale;
    active.current =
      active.direction === "move"
        ? {
            position: {
              x: Math.max(0, active.placement.position.x + dx),
              y: Math.max(0, active.placement.position.y + dy),
            },
            size: active.placement.size,
          }
        : resizeCardGeometry(active.placement, active.direction, dx, dy);
    setPreview(active.current);
  }
  function finish(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag(event);
    gesture.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (
      JSON.stringify(active.current) ===
      JSON.stringify({
        position: active.placement.position,
        size: active.placement.size,
      })
    ) {
      setPreview(undefined);
      return;
    }
    const result =
      active.direction === "move"
        ? actions.current.move(active.placement, active.current.position)
        : actions.current.resize(active.placement, active.current);
    void result.catch(error).finally(() => setPreview(undefined));
  }
  function cancelGesture() {
    gesture.current = undefined;
    setPreview(undefined);
  }
  function startEditing() {
    if (!object || editing) return;
    setMoving(false);
    setAdjusting(false);
    setDraft(objectText(object));
    setEditorError("");
    setEditing(true);
  }
  async function save() {
    if (saving || !draft.trim()) return;
    setSaving(true);
    setEditorError("");
    try {
      await actions.current.editPlacement(p, draft);
      setEditing(false);
      setAdjusting(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setEditorError(message);
      actions.current.setStatus(message);
    } finally {
      setSaving(false);
    }
  }
  const canEdit =
    object?.kind === "content.note" || object?.kind === "content.fragment";
  function toggleSelection() {
    setSelected((current) =>
      current.includes(p.placementId)
        ? current.filter((id) => id !== p.placementId)
        : [...current, p.placementId],
    );
  }
  function startMoving() {
    setMoving(true);
    setEditing(false);
    requestAnimationFrame(() => cardRef.current?.focus());
    actions.current.setStatus("拖动卡片或用方向键移动；按 Esc 完成。");
  }
  function moveByKey(key: string) {
    const delta: Record<string, number[]> = {
      ArrowLeft: [-20, 0],
      ArrowRight: [20, 0],
      ArrowUp: [0, -20],
      ArrowDown: [0, 20],
    };
    const d = delta[key];
    if (!d) return false;
    void actions.current
      .move(p, {
        x: Math.max(0, p.position.x + d[0]),
        y: Math.max(0, p.position.y + d[1]),
      })
      .catch(error);
    return true;
  }
  return (
    <Menu
      openOnContext
      open={menuOpen}
      onOpenChange={(_, data) => setMenuOpen(data.open)}
    >
      <MenuTrigger disableButtonEnhancement>
        <div
          ref={cardRef}
          className={`object-placement${editing ? " is-editing" : ""}${moving ? " is-moving" : ""}${selected ? " is-selected" : ""}${adjusting ? " is-adjusting" : ""}`}
          data-placement-id={p.placementId}
          aria-label={`白板卡片：${object?.title ?? "正在读取"}`}
          aria-description={
            selected
              ? "已选择；右键或 Shift+F10 打开菜单"
              : "右键或 Shift+F10 打开菜单"
          }
          tabIndex={0}
          draggable={!editing && !moving && !!object}
          onDragStart={(event) => {
            if (!object) return;
            event.dataTransfer.effectAllowed = "copy";
            writeObjectTransfer(
              event.dataTransfer,
              makeObjectTransfer([refOf(object)], objectText(object)),
            );
          }}
          onClick={(event) => {
            if (
              (event.target as Element).closest(
                "a,button,input,textarea,.object-card-editor",
              )
            )
              return;
            if (event.ctrlKey || event.metaKey) {
              toggleSelection();
              return;
            }
            if (canEdit && !moving) startEditing();
          }}
          onPointerDown={(event) => {
            if (moving) begin(event, "move");
          }}
          onPointerMove={drag}
          onPointerUp={finish}
          onPointerCancel={cancelGesture}
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(true);
              return;
            }
            if (event.target !== event.currentTarget) return;
            if (event.key === "Escape") {
              setMoving(false);
              setEditing(false);
              setAdjusting(false);
            }
            if (moving && moveByKey(event.key)) event.preventDefault();
            if (!moving && canEdit && event.key === "Enter") {
              event.preventDefault();
              startEditing();
            }
          }}
          style={{
            left: geometry.position.x,
            top: geometry.position.y,
            width: geometry.size.width,
            height: geometry.size.height,
          }}
        >
          {moving || adjusting ? (
            <Tooltip
              content={moving ? "完成移动" : "完成调整"}
              relationship="description"
            >
              <Button
                size="small"
                className="object-move-done"
                aria-label={moving ? "完成移动" : "完成调整"}
                icon={<CheckmarkRegular />}
                onClick={() => {
                  setMoving(false);
                  setAdjusting(false);
                }}
              />
            </Tooltip>
          ) : null}
          {object?.assets.length ? (
            <div className="object-placement-assets">
              {object.assets.map((asset) => (
                <ObjectAssetImage
                  key={asset.assetId}
                  repository={actions.current.repository}
                  assetId={asset.assetId}
                  alt={assetCaptions.get(asset.assetId) || "保存的图片"}
                  maxHeight={editing ? 80 : Math.max(80, p.size.height - 30)}
                />
              ))}
            </div>
          ) : null}
          {object ? (
            <ObjectSurface
              object={object}
              presentation="canvas"
              onEdit={canEdit && !moving ? startEditing : undefined}
              editor={
                editing ? (
                  <div className="object-card-editor">
                    {object.kind === "content.fragment" ? (
                      <span className="object-meta">
                        保存为笔记，并保留摘录来源
                      </span>
                    ) : null}
                    <Textarea
                      autoFocus
                      aria-label="编辑卡片正文"
                      value={draft}
                      disabled={saving}
                      onChange={(_, data) => setDraft(data.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape" && !saving)
                          setEditing(false);
                        if (
                          (event.ctrlKey || event.metaKey) &&
                          event.key === "Enter"
                        ) {
                          event.preventDefault();
                          void save();
                        }
                      }}
                    />
                    {editorError ? (
                      <span role="alert">{editorError}</span>
                    ) : null}
                    <div className="object-toolbar">
                      <Tooltip
                        content={
                          object.kind === "content.fragment"
                            ? "保存为笔记"
                            : "保存修改"
                        }
                        relationship="description"
                      >
                        <Button
                          aria-label={
                            object.kind === "content.fragment"
                              ? "保存为笔记"
                              : "保存修改"
                          }
                          icon={<CheckmarkRegular />}
                          size="small"
                          appearance="primary"
                          disabled={saving || !draft.trim()}
                          onClick={() => void save()}
                        ></Button>
                      </Tooltip>
                      <Tooltip content="取消编辑" relationship="description">
                        <Button
                          aria-label="取消编辑"
                          icon={<DismissRegular />}
                          size="small"
                          disabled={saving}
                          onClick={() => setEditing(false)}
                        ></Button>
                      </Tooltip>
                    </div>
                  </div>
                ) : undefined
              }
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
            <p>
              {object === null ? "内容不可用，引用仍保留。" : "正在读取内容…"}
            </p>
          )}
          {(editing || adjusting) &&
            (Object.keys(resizeLabels) as ResizeDirection[]).map(
              (direction) => (
                <Tooltip
                  key={direction}
                  content={`拖动${resizeLabels[direction]}调整大小；也可使用方向键`}
                  relationship="description"
                >
                  <button
                    type="button"
                    className={`object-resize-handle object-resize-${direction}`}
                    aria-label={`调整卡片大小：${resizeLabels[direction]}`}
                    onPointerDown={(event) => begin(event, direction)}
                    onPointerMove={drag}
                    onPointerUp={finish}
                    onPointerCancel={cancelGesture}
                    onLostPointerCapture={() => {
                      if (gesture.current) cancelGesture();
                    }}
                    onKeyDown={(event) => {
                      const delta: Record<string, number[]> = {
                        ArrowLeft: [-20, 0],
                        ArrowRight: [20, 0],
                        ArrowUp: [0, -20],
                        ArrowDown: [0, 20],
                      };
                      const d = delta[event.key];
                      if (!d) return;
                      event.preventDefault();
                      void actions.current
                        .resize(p, resizeCardGeometry(p, direction, d[0], d[1]))
                        .catch(error);
                    }}
                  />
                </Tooltip>
              ),
            )}
        </div>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem
            icon={<EditRegular />}
            disabled={!canEdit}
            onClick={startEditing}
          >
            {object?.kind === "content.fragment" ? "编辑为笔记" : "编辑内容"}
          </MenuItem>
          <MenuItem
            icon={<SettingsRegular />}
            onClick={() => setAdjusting(true)}
          >
            调整卡片大小
          </MenuItem>
          <MenuItem
            icon={<ArrowMoveRegular />}
            disabled={editing}
            onClick={startMoving}
          >
            移动卡片
          </MenuItem>
          <MenuItem
            icon={selected ? <CheckmarkRegular /> : <SelectAllOnRegular />}
            onClick={toggleSelection}
          >
            {selected ? "取消选择" : "选择卡片"}
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<ChatAddRegular />}
            disabled={!object}
            onClick={() => object && actions.current.addToTray([refOf(object)])}
          >
            加入对话
          </MenuItem>
          <MenuItem
            icon={<CopyRegular />}
            disabled={!object}
            onClick={() =>
              object &&
              void navigator.clipboard
                .writeText(
                  `${objectText(object)}\n\n${objectLink(refOf(object))}`,
                )
                .catch(error)
            }
          >
            复制内容与来源
          </MenuItem>
          <MenuItem
            icon={<CopyRegular />}
            disabled={!object}
            onClick={() =>
              object &&
              void actions.current.repository
                .copy(refOf(object))
                .then(() => actions.current.refresh())
                .catch(error)
            }
          >
            制作独立副本
          </MenuItem>
          <MenuItem
            icon={<LinkRegular />}
            disabled={!object?.provenance.sourceRefs.length}
            onClick={() =>
              object &&
              void actions.current
                .openSource(object)
                .then((source) => source && setDetails(source))
                .catch(error)
            }
          >
            查看来源
          </MenuItem>
          <MenuItem
            icon={<HistoryRegular />}
            disabled={!object}
            onClick={() => object && setDetails(object)}
          >
            关联与历史
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<DeleteRegular />}
            onClick={() =>
              void actions.current.removePlacement(p.placementId).catch(error)
            }
          >
            移除卡片
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
});
