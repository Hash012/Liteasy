export type PdfSelectionMenuPosition = {
  left: number;
  placement: "above" | "below";
  top: number;
};

type SelectionRect = {
  bottom: number;
  left: number;
  top: number;
  width: number;
};

type StageRect = {
  left: number;
  top: number;
};

/**
 * Anchors the menu to the selection itself. CSS handles the menu's real height, so this does not
 * rely on a fixed pixel guess that drifts as actions are added or fonts change.
 */
export function resolvePdfSelectionMenuPosition(input: {
  contentWidth: number;
  menuHalfWidth?: number;
  minimumSpaceAbove?: number;
  rect: SelectionRect;
  scrollLeft: number;
  scrollTop: number;
  stageRect: StageRect;
}): PdfSelectionMenuPosition {
  const menuHalfWidth = input.menuHalfWidth ?? 102;
  const minimumSpaceAbove = input.minimumSpaceAbove ?? 210;
  const relativeTop = input.rect.top - input.stageRect.top;
  const placement = relativeTop >= minimumSpaceAbove ? "above" : "below";
  const rawLeft = input.rect.left - input.stageRect.left + input.scrollLeft + input.rect.width / 2;
  const maximumLeft = Math.max(menuHalfWidth, input.contentWidth - menuHalfWidth);

  return {
    left: Math.min(maximumLeft, Math.max(menuHalfWidth, rawLeft)),
    placement,
    top: (placement === "above" ? input.rect.top : input.rect.bottom) - input.stageRect.top +
      input.scrollTop
  };
}
