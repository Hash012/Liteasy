type PaneResizerProps = {
  ariaLabel: string;
  axis?: "horizontal" | "vertical";
  onResize: (deltaPixels: number) => void;
};

export function PaneResizer({ ariaLabel, axis = "horizontal", onResize }: PaneResizerProps) {
  return (
    <div
      aria-label={ariaLabel}
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      className={`pane-resizer ${axis}`}
      onPointerDown={(event) => {
        let previousX = event.clientX;
        let previousY = event.clientY;

        function handlePointerMove(moveEvent: PointerEvent) {
          const delta =
            axis === "horizontal"
              ? moveEvent.clientX - previousX
              : moveEvent.clientY - previousY;
          previousX = moveEvent.clientX;
          previousY = moveEvent.clientY;
          onResize(delta);
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
