import { parseCanvasFile } from "../boards/boardFileFormat";
import type { ObjectRepository } from "../objects/objectRepository";
import { objectText, refOf, type ObjectEnvelope } from "../objects/object.types";
import { AgentAssetError } from "./agentAsset.types";

/** Portable structure for model editing, without embedding image bytes. */
export async function readAgentBoard(repository: ObjectRepository, board: ObjectEnvelope) {
  const placements = await repository.listPlacements(board.objectId);
  const connections = await repository.listEdges(board.objectId);
  const nodes = [];
  let characters = 0;
  for (const placement of placements) {
    const object = await repository.get(placement.ref);
    const text = objectText(object);
    characters += text.length;
    if (characters > 8 * 1024 * 1024) throw new AgentAssetError("invalid_request", "白板文字内容过大，请按卡片读取和处理。");
    nodes.push({ id: placement.placementId, type: "text", x: placement.position.x, y: placement.position.y,
      width: placement.size.width, height: placement.size.height, text,
      liteasy: { ref: placement.ref, title: object.title, imageCount: object.assets.length } });
  }
  if ((await repository.resolveLatest(board.objectId)).revision !== board.revision) throw new AgentAssetError("revision_conflict", "白板结构已变化，请重新读取。");
  return JSON.stringify({ nodes, edges: connections.map((edge) => ({ id: edge.edgeId, fromNode: edge.from, toNode: edge.to,
    fromSide: edge.fromSide, toSide: edge.toSide, fromEnd: edge.fromEnd, toEnd: edge.toEnd, label: edge.label })) }, null, 2);
}

export async function writeAgentBoard(repository: ObjectRepository, board: ObjectEnvelope, text: string, active: () => boolean) {
  const document = parseCanvasFile(text);
  if (document.nodes.some((node) => node.type === "file" || node.type === "group")) throw new AgentAssetError("invalid_request", "内部白板请使用文字或链接卡片；文件引用与分组请通过 Canvas 文件地址编辑。");
  const placements = new Map((await repository.listPlacements(board.objectId)).map((item) => [item.placementId, item]));
  const nodes = [];
  for (const node of document.nodes) {
    const placement = placements.get(node.id);
    const previous = placement ? await repository.get(placement.ref) : undefined;
    const content = node.type === "link" ? node.url! : node.text!;
    const unchanged = previous && objectText(previous) === content;
    nodes.push({ id: node.id, position: { x: node.x, y: node.y }, size: { width: node.width, height: node.height },
      ...(unchanged ? { ref: refOf(previous) } : { draft: {
        kind: "content.note" as const, title: previous?.title || content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80) || "笔记",
        assets: previous?.assets, paperAnchors: previous?.paperAnchors,
        ...(previous ? { sourceRefs: [refOf(previous)], derivedFrom: [refOf(previous)] } : {}),
        content: { schema: "liteasy.note/v1" as const, payload: { text: content, origin: "derived" as const } },
      } }),
    });
  }
  if (!active()) throw new AgentAssetError("scope_changed", "账号已切换，白板未写入。");
  return repository.importBoardFile({ title: board.title, replaceRef: refOf(board), nodes,
    edges: document.edges.map((edge) => ({ edgeId: edge.id, from: edge.fromNode, to: edge.toNode,
      fromSide: edge.fromSide, toSide: edge.toSide, fromEnd: edge.fromEnd, toEnd: edge.toEnd,
      label: edge.label, kind: "related_to" })), operationId: crypto.randomUUID() });
}
