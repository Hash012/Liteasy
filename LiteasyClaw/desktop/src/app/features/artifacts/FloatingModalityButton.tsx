import { useEffect, useRef, useState } from "react";
import type { ArtifactType } from "./artifact.types";

type FloatingModalityButtonProps = {
  analysisHint: string;
  canStartAnalysis: boolean;
  onStartAnalysis: (artifactType: ArtifactType) => void;
};

const modalityOptions: Array<{
  className: string;
  label: string;
  type: ArtifactType;
}> = [
  { className: "tree", label: "树形展开", type: "tree" },
  { className: "mindmap", label: "思维导图", type: "mindmap" },
  { className: "layered-graph", label: "分层关系图", type: "layered_graph" },
  { className: "ppt", label: "PPT", type: "ppt" },
  { className: "comparison", label: "对比表", type: "comparison_table" },
  { className: "thin-reading", label: "薄读", type: "thin_reading" }
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function FloatingModalityButton({
  analysisHint,
  canStartAnalysis,
  onStartAnalysis
}: FloatingModalityButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const movedRef = useRef(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

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
      aria-label="中间栏悬浮模态选择"
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
      {expanded ? modalityOptions.map((option) => (
        <button
          className={`floating-modality-option ${option.className}`}
          disabled={!canStartAnalysis}
          key={option.type}
          onClick={() => onStartAnalysis(option.type)}
          title={analysisHint}
          type="button"
        >
          {option.label}
        </button>
      )) : null}
      <button
        aria-expanded={expanded}
        aria-label={expanded ? "关闭模态选择" : "打开模态选择"}
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
          if (!movedRef.current) {
            setExpanded((current) => !current);
          }
        }}
        title={analysisHint}
        type="button"
      >
        模态
      </button>
    </div>
  );
}
