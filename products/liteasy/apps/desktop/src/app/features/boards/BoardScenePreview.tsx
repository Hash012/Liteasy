import { useEffect, useRef, useState } from "react";
import { ContentExcerpt } from "../markdown/ContentExcerpt";
import type { BoardViewSnapshot } from "../resource-filesystem/resourcePresentation";
import { ReferenceSourceContext } from "../resource-links/ResourceReferencesContext";
import "./boardScenePreview.css";

/** Read-only spatial projection; the editable board remains the sole mutation surface. */
export function BoardScenePreview({ scene }: { scene: BoardViewSnapshot }) {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(560);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => { const next = entries[0].contentRect.width; if (next > 0) setWidth(next); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const members = scene.members, positions = new Map(members.map(member => [member.placement.placementId, member.placement]));
  const left = Math.min(0, ...members.map(m => m.placement.position.x)), top = Math.min(0, ...members.map(m => m.placement.position.y));
  const right = Math.max(320, ...members.map(m => m.placement.position.x + m.placement.size.width));
  const bottom = Math.max(160, ...members.map(m => m.placement.position.y + m.placement.size.height));
  const scale = Math.min(1, width / (right - left + 24), 420 / (bottom - top + 24));
  return <div ref={ref} className="board-scene-preview" aria-label="白板空间预览">
    {!members.length ? <p>空白白板</p> : <div className="board-scene-preview__viewport" style={{ height: (bottom - top + 24) * scale }}>
      <div className="board-scene-preview__scene" style={{ width: right - left + 24, height: bottom - top + 24, transform: `scale(${scale})` }}>
        <svg aria-label="卡片连接" className="board-scene-preview__edges" width={right - left + 24} height={bottom - top + 24}>
          {scene.edges.map(edge => { const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null;
            const x1 = a.position.x + a.size.width / 2 - left + 12, y1 = a.position.y + a.size.height / 2 - top + 12;
            const x2 = b.position.x + b.size.width / 2 - left + 12, y2 = b.position.y + b.size.height / 2 - top + 12;
            return <g key={edge.edgeId}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" /><title>{edge.label || "卡片连接"}</title></g>;
          })}
        </svg>
        {members.map(member => <article key={member.placement.placementId} className="board-scene-preview__card" aria-label={member.title}
          style={{ left: member.placement.position.x - left + 12, top: member.placement.position.y - top + 12, width: member.placement.size.width, height: member.placement.size.height }}>
          <ReferenceSourceContext.Provider value={member.path}><ContentExcerpt content={member.content} /></ReferenceSourceContext.Provider>
        </article>)}
      </div>
    </div>}
    <small>{members.length} 张卡片 · {scene.edges.length} 条连接</small>
  </div>;
}
