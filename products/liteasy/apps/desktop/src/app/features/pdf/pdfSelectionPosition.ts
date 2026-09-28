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

/** Fit the measured menu into the visible part of the scrolled reader, not the full PDF width. */
export function fitPdfSelectionMenuPosition(input: {
  anchor: PdfSelectionMenuPosition;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
}): { left: number; top: number; maxHeight: number } {
  const gap = 8;
  const maxHeight = Math.max(0, input.viewportHeight - gap * 2);
  const menuWidth = Math.min(input.menuWidth, Math.max(0, input.viewportWidth - gap * 2));
  const menuHeight = Math.min(input.menuHeight, maxHeight);
  const minLeft = input.scrollLeft + gap;
  const minTop = input.scrollTop + gap;
  const desiredTop = input.anchor.placement === "above"
    ? input.anchor.top - menuHeight - gap
    : input.anchor.top + gap;
  return {
    left: Math.max(minLeft, Math.min(input.anchor.left - menuWidth / 2, input.scrollLeft + input.viewportWidth - gap - menuWidth)),
    top: Math.max(minTop, Math.min(desiredTop, input.scrollTop + input.viewportHeight - gap - menuHeight)),
    maxHeight
  };
}
