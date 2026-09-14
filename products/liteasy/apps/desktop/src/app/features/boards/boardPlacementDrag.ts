import type { Placement } from "../objects/object.types";

// This augments the regular object reference payload; other surfaces can ignore it.
export const BOARD_PLACEMENT_MIME =
  "application/x-liteasy-board-placement+json";
type PlacementDrag = {
  placementId: string;
  boardId: string;
  offsetX: number;
  offsetY: number;
};

export function writePlacementDrag(
  data: DataTransfer,
  placement: Placement,
  bounds: DOMRect,
  clientX: number,
  clientY: number,
) {
  const scale = bounds.width / placement.size.width || 1;
  const value: PlacementDrag = {
    placementId: placement.placementId,
    boardId: placement.boardId,
    offsetX: (clientX - bounds.left) / scale,
    offsetY: (clientY - bounds.top) / scale,
  };
  data.setData(BOARD_PLACEMENT_MIME, JSON.stringify(value));
}

export function readPlacementDrag(
  data: DataTransfer,
): PlacementDrag | undefined {
  const raw = data.getData(BOARD_PLACEMENT_MIME);
  if (!raw || raw.length > 4096) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return;
    const item = value as Partial<PlacementDrag>;
    if (
      typeof item.placementId !== "string" ||
      typeof item.boardId !== "string" ||
      typeof item.offsetX !== "number" ||
      !Number.isFinite(item.offsetX) ||
      typeof item.offsetY !== "number" ||
      !Number.isFinite(item.offsetY)
    )
      return;
    return item as PlacementDrag;
  } catch {
    return;
  }
}
