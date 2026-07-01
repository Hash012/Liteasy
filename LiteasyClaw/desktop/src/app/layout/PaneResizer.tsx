type PaneResizerProps = {
  ariaLabel: string;
  onResize: (deltaPixels: number) => void;
};

export function PaneResizer({ ariaLabel, onResize }: PaneResizerProps) {
  return (
    <div
      aria-label={ariaLabel}
      className="pane-resizer"
      onPointerDown={(event) => {
        const startX = event.clientX;

        function handlePointerMove(moveEvent: PointerEvent) {
          onResize(moveEvent.clientX - startX);
        }

        function handlePointerUp() {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
        }

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
      }}
      role="separator"
    />
  );
}
