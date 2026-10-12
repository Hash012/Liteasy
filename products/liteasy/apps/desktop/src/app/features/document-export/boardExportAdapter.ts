import { createBlockRegistry, type ComponentTree } from "../visual-blocks/blockRegistry";
import { createSpatialAtlas } from "./spatialAtlas";
import { objectText, refOf, type ObjectEnvelope, type Placement } from "../objects/object.types";
import type { ObjectRepository } from "../objects/objectRepository";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { compileDocument } from "./documentCompiler";
import { sha256, stableJson, defaultExportOptions, type ExportOptions, type ExportSource } from "./documentExport.types";

const literal = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>!|])/g, "\\$1");
/** Semantic overview only; full card bodies below are read from the model. */
function boardOverview(placements: Placement[], edges: Array<{ from: string; to: string }>) {
  if (!placements.length) return "";
  const canvas = globalThis.document.createElement("canvas"); canvas.width = 900; canvas.height = 560;
  const context = canvas.getContext("2d"); if (!context) return "";
  const left = Math.min(...placements.map(p => p.position.x)), top = Math.min(...placements.map(p => p.position.y));
  const right = Math.max(...placements.map(p => p.position.x + p.size.width)), bottom = Math.max(...placements.map(p => p.position.y + p.size.height));
  const scale = Math.min(860 / Math.max(1, right - left), 520 / Math.max(1, bottom - top));
  const geometry = (p: Placement) => ({ x: 20 + (p.position.x - left) * scale, y: 20 + (p.position.y - top) * scale, width: p.size.width * scale, height: p.size.height * scale });
  context.fillStyle = "white"; context.fillRect(0, 0, 900, 560); context.strokeStyle = "#738c88";
  for (const edge of edges) { const from = placements.find(p => p.placementId === edge.from), to = placements.find(p => p.placementId === edge.to); if (!from || !to) continue; const a = geometry(from), b = geometry(to); context.beginPath(); context.moveTo(a.x + a.width / 2, a.y + a.height / 2); context.lineTo(b.x + b.width / 2, b.y + b.height / 2); context.stroke(); }
  placements.forEach((p, index) => { const rect = geometry(p); context.fillStyle = "#eef4f2"; context.fillRect(rect.x, rect.y, rect.width, rect.height); context.strokeRect(rect.x, rect.y, rect.width, rect.height); context.fillStyle = "#244f4c"; context.font = "bold 14px sans-serif"; context.fillText(String(index + 1), rect.x + 4, rect.y + 16); });
  return canvas.toDataURL("image/png");
}
export async function compileBoardDocument(board: ObjectEnvelope, repository: ObjectRepository, input: { assets?: AgentAssetService; options?: Partial<ExportOptions>; signal?: AbortSignal; active?: () => boolean; blockRegistry?: ReturnType<typeof createBlockRegistry> } = {}) {
  const options = { ...defaultExportOptions, ...input.options };
  if (options.scope === "excerpt" || options.scope === "current_subtree") throw new Error("白板请选择全部或选中卡片。");
  const snapshot = await repository.captureBoardExportSnapshot(refOf(board), options.scope === "selected_nodes" ? options.nodeIds : undefined);
  const selected = options.scope === "selected_nodes" ? new Set(options.nodeIds) : undefined;
  if (selected && (!selected.size || [...selected].some(id => !snapshot.placements.some(p => p.placementId === id)))) throw new Error("所选白板卡片已变化，请重新选择。");
  const placements = snapshot.placements.filter(p => !selected || selected.has(p.placementId)).sort((a, b) => (snapshot.presentations[a.placementId]?.groupId ?? "").localeCompare(snapshot.presentations[b.placementId]?.groupId ?? "", "en") || a.position.y - b.position.y || a.position.x - b.position.x || a.placementId.localeCompare(b.placementId, "en"));
  const objects = new Map(snapshot.objects.map(object => [JSON.stringify(refOf(object)), object]));
  const numbers = new Map(placements.map((p, index) => [p.placementId, index + 1]));
  const output: string[] = [`# ${literal(snapshot.board.title)}`, "", (snapshot.board.kind === "workspace.board" && options.scope === "full_saved" ? snapshot.board.content.payload.description : ""), "", ...(globalThis.document ? (() => { const image = boardOverview(placements, snapshot.edges); return image ? ["## 全局总览", "", `![卡片编号总览；正文见下方阅读报告](${image})`, "", "总览用于定位；关系方向与标签见文末说明。", ""] : []; })() : []), "## 卡片正文", ""];
  const emitted = new Map<string, number>();
  const sources: ExportSource[] = [{ identity: board.objectId, revision: board.revision, state: "pinned" as const, sha256: await sha256(stableJson({ board: snapshot.board, placements, edges: snapshot.edges, presentations: snapshot.presentations })) }];
  const allAssets = input.assets;
  // Compile each complete model independently so relative image bases stay attached to their owner.
  const documents = [];
  const bodies: Record<string, import("./documentExport.types").DocumentNode[]> = {};
  for (const p of placements) {
    input.signal?.throwIfAborted();
    const key = JSON.stringify(p.ref), object = objects.get(key);
    if (!object || object.lifecycle !== "active") throw new Error("白板包含不可读取的成员，导出已中止。");
    const number = numbers.get(p.placementId)!;
    output.push(`### 卡片 ${number}：${literal(object.title)}`, "", `位置：(${p.position.x}, ${p.position.y})；尺寸：${p.size.width} × ${p.size.height}。`, "");
    const first = emitted.get(key);
    if (first) { output.push(`正文同卡片 ${first}；此放置的位置与关系独立保留。`, ""); continue; }
    emitted.set(key, number);
    const structured = snapshot.structured.find(entry => JSON.stringify(entry.ref) === key)?.block;
    let bodyMarkdown = objectText(object);
    if (structured) {
      const registry = input.blockRegistry ?? createBlockRegistry();
      const type = registry.resolve(structured.type.id, structured.type.version);
      const data = registry.instantiate(type.id, type.version, structured.data);
      bodyMarkdown = typeof data.text === "string" ? data.text : "";
      if (type.family === "MediaBlock" && typeof data.image === "string" && data.image) bodyMarkdown += `\n\n![${literal(object.title)}](${data.image})`;
      if (type.family === "CollectionBlock" && Array.isArray(data.rows) && data.rows.length) {
        const rows = data.rows as string[][];
        const width = Math.max(...rows.map(row => row.length));
        bodyMarkdown += "\n\n" + rows.map((row, index) => `| ${Array.from({ length: width }, (_, i) => literal(String(row[i] ?? ""))).join(" | ")} |` + (index === 0 ? `\n| ${Array(width).fill("---").join(" | ")} |` : "")).join("\n");
      }
      if (type.family === "ResourceBlock") bodyMarkdown += "\n\n资源引用保留在原生白板中；阅读报告不把未读取的引用当作正文。";
      const extraFields = Object.keys(data).filter(field => !["text", "image", "rows", "path"].includes(field));
      for (const field of extraFields) bodyMarkdown += `\n\n### ${literal(field)}\n\n${typeof data[field] === "string" ? data[field] : "```json\n" + JSON.stringify(data[field], null, 2) + "\n```"}`;
    }
    const basePath = liteasyPath(repository.scopeId, { kind: "object", ref: p.ref });
    const header = await compileDocument({ ...input, title: object.title, markdown: output.splice(0).join("\n"), options, sources });
    header.assets.forEach(asset => { asset.origin = "generated"; });
    const body = await compileDocument({ ...input, assets: allAssets, basePath, title: object.title, markdown: bodyMarkdown, options, sources: [{ identity: object.objectId, revision: object.revision, state: "pinned", sha256: await sha256(stableJson({ object, structured })) }] });
    documents.push(header, body); sources.push(...body.sources);
    bodies[key] = body.nodes;
  }
  output.push("## 关系", "");
  for (const edge of snapshot.edges) {
    const from = numbers.get(edge.from), to = numbers.get(edge.to);
    if (!from || !to) continue;
    const reversed = edge.fromEnd === "arrow" && edge.toEnd !== "arrow";
    const arrow = edge.fromEnd === "arrow" && edge.toEnd === "arrow" ? "↔" : edge.fromEnd === "arrow" || edge.toEnd === "arrow" ? "→" : "—";
    output.push(`- 卡片 ${reversed ? to : from} ${arrow} 卡片 ${reversed ? from : to}：${literal(edge.label || "未标注关系")}`);
  }
  const tail = await compileDocument({ ...input, title: board.title, markdown: output.join("\n"), options, sources });
  tail.nodes = [...documents.flatMap(document => document.nodes), ...tail.nodes];
  const assets = [...documents.flatMap(document => document.assets), ...tail.assets];
  tail.assets = [...new Map(assets.map(asset => [asset.path, asset])).values()];
  if (tail.assets.reduce((total, asset) => total + asset.bytes.length, 0) > 24 * 1024 * 1024) throw new Error("白板附件总大小超过 24 MiB，请拆分白板。");
  tail.diagnostics.unshift(...documents.flatMap(document => document.diagnostics));
  tail.sourceDigest = await sha256(stableJson({ sources, assets: tail.assets.filter(asset => asset.origin !== "generated").map(({ sha256, path }) => ({ sha256, path })) }));
  if (options.profileId === "spatial-atlas/v1") {
    const styled = placements.map(p => ({ ...p, fontSize: snapshot.presentations[p.placementId]?.fontSize ?? snapshot.presentations.$board?.fontSize ?? 14 }));
    if (styled.some(p => p.fontSize * 0.75 < 9)) throw new Error("部分空间标签低于 9pt，请增大卡片字体或改用阅读报告。");
    tail.spatialAtlas = createSpatialAtlas(placements, snapshot.edges, bodies, options);
    tail.diagnostics.push({ code: "spatial_clipping_appendix", severity: "warning", message: "空间页保持已保存坐标，跨页卡片会显示裁切/续页提示；完整卡片正文与关系保留在报告附录。" });
  }
  tail.scopeId = repository.scopeId;
  tail.assertAuthorized = async () => { await repository.get(refOf(snapshot.board)); for (const object of snapshot.objects) await repository.get(refOf(object)); };
  return tail;
}
