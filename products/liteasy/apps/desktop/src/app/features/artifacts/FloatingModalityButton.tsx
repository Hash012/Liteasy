import { useEffect, useRef, useState, type CSSProperties } from "react";

type FloatingModalityButtonProps = {
  analysisHint: string;
  canStartAnalysis: boolean;
  generationProgress?: number;
  onStartAnalysis: (artifactType: "thin_reading") => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function FloatingModalityButton({
  analysisHint,
  canStartAnalysis,
  generationProgress,
  onStartAnalysis
}: FloatingModalityButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const normalizedProgress = generationProgress === undefined
    ? undefined
    : clamp(generationProgress, 0, 100);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const root = rootRef.current;
      const parent = root?.parentElement;
      if (!root || !parent) {
        return;
      }

      const parentRect = parent.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const nextX = event.clientX - parentRect.left - dragOffsetRef.current.x;
      const nextY = event.clientY - parentRect.top - dragOffsetRef.current.y;

      movedRef.current = true;

      setPosition({
        x: clamp(nextX, 8, Math.max(8, parentRect.width - rootRect.width - 8)),
        y: clamp(nextY, 48, Math.max(48, parentRect.height - rootRect.height - 8))
      });
    }

    function handlePointerUp() {
      setDragging(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragging]);

  return (
    <div
      aria-label="中间栏悬浮薄读"
      className={`floating-modality-launcher${dragging ? " dragging" : ""}`}
      ref={rootRef}
      style={
        position
          ? {
              left: `${position.x}px`,
              top: `${position.y}px`
            }
          : undefined
      }
    >
      {normalizedProgress !== undefined ? (
        <span
          aria-label="薄读生成进度"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(normalizedProgress)}
          className="floating-modality-progress-ring"
          role="progressbar"
          style={{
            "--floating-modality-progress": `${normalizedProgress}%`
          } as CSSProperties}
        />
      ) : null}
      <button
        aria-disabled={!canStartAnalysis}
        aria-label="薄读"
        className="floating-modality-main"
        onPointerDown={(event) => {
          const root = rootRef.current;
          if (!root) {
            return;
          }
          const rect = root.getBoundingClientRect();
          dragOffsetRef.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          };
          movedRef.current = false;
          setDragging(true);
        }}
        onClick={() => {
          if (!movedRef.current && canStartAnalysis) {
            onStartAnalysis("thin_reading");
          }
        }}
        title={analysisHint}
        type="button"
      >
        薄读
      </button>
    </div>
  );
}
