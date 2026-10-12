import type { Placement, BoardConnection } from "../objects/object.types";
import type { DocumentNode, ExportOptions, ExportDocument } from "./documentExport.types";
import { documentNodeHtml, escapeDocumentHtml } from "./documentHtml";
export type SpatialAtlas = { placements: Placement[]; edges: BoardConnection[]; bodies: Record<string, DocumentNode[]>; pages: Array<{ x: number; y: number; width: number; height: number }> };
export function createSpatialAtlas(placements: Placement[], edges: BoardConnection[], bodies: Record<string, DocumentNode[]>, options: ExportOptions): SpatialAtlas {
  const paper = options.paperSize === "A3" ? [297, 420] : [210, 297];
  if (options.orientation === "landscape") paper.reverse();
  const width = (paper[0] - 40) * 96 / 25.4, height = (paper[1] - 48) * 96 / 25.4;
  const left = placements.length ? Math.min(...placements.map(p => p.position.x)) : 0, top = placements.length ? Math.min(...placements.map(p => p.position.y)) : 0;
  const right = Math.max(0, ...placements.map(p => p.position.x + p.size.width)), bottom = Math.max(0, ...placements.map(p => p.position.y + p.size.height));
  const columns = Math.max(1, Math.ceil((right - left) / width)), rows = Math.max(1, Math.ceil((bottom - top) / height));
  if (columns * rows > 200) throw new Error("空间图集超过 200 页，请缩小选择区域或改用 A3/阅读报告。");
  const pages = Array.from({ length: rows * columns }, (_, index) => ({ x: left + index % columns * width, y: top + Math.floor(index / columns) * height, width, height }));
  return { placements, edges, bodies, pages };
}
/** Host generated geometry; user HTML/CSS is never interpolated as style. */
export function spatialAtlasHtml(atlas: SpatialAtlas, document: ExportDocument) {
  const numbers = new Map(atlas.placements.map((p, index) => [p.placementId, index + 1]));
  return atlas.pages.map((page, index) => {
    const intersect = (p: Placement) => p.position.x < page.x + page.width && p.position.x + p.size.width > page.x && p.position.y < page.y + page.height && p.position.y + p.size.height > page.y;
    const cards = atlas.placements.filter(intersect).map(p => {
      const x = p.position.x - page.x, y = p.position.y - page.y;
      const continued = x < 0 || y < 0 || x + p.size.width > page.width || y + p.size.height > page.height;
      return `<article class="atlas-card" style="left:${x}px;top:${y}px;width:${p.size.width}px;height:${p.size.height}px"><strong>卡片 ${numbers.get(p.placementId)}${continued ? "（裁切/续页，完整正文见附录）" : "（完整正文见附录）"}</strong>${(atlas.bodies[JSON.stringify(p.ref)] ?? []).map(node => documentNodeHtml(node, document)).join("")}</article>`;
    }).join("");
    // Native canvas connection semantics have no inferred causal/hierarchy meaning.
    const links = atlas.edges.map(edge => {
      const a = atlas.placements.find(p => p.placementId === edge.from), b = atlas.placements.find(p => p.placementId === edge.to);
      if (!a || !b) return "";
      const ax = a.position.x + a.size.width / 2 - page.x, ay = a.position.y + a.size.height / 2 - page.y;
      const bx = b.position.x + b.size.width / 2 - page.x, by = b.position.y + b.size.height / 2 - page.y;
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#738c88"/><text x="${(ax + bx) / 2}" y="${(ay + by) / 2}" font-size="12">${escapeDocumentHtml(`${numbers.get(a.placementId)}–${numbers.get(b.placementId)} ${edge.label || "未标注关系"}`)}</text>`;
    }).join("");
    return `<section class="atlas-page"><p>空间图集 ${index + 1}/${atlas.pages.length} · 行列定位 (${Math.round(page.x)}, ${Math.round(page.y)}) · 连线编号对应文末关系表</p><div class="atlas-viewport" style="width:${page.width}px;height:${page.height}px"><svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}">${links}</svg>${cards}</div></section>`;
  }).join("\n");
}
