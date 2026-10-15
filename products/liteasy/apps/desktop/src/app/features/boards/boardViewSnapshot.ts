import { boardContextSnapshotSchema } from "../context/objectContext";
import type { ObjectRepository } from "../objects/objectRepository";
import { objectText, refOf, type ObjectEnvelope } from "../objects/object.types";
import { sourceContent } from "../markdown/contentStructure";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { AgentAssetError } from "../resource-filesystem/agentAsset.types";
import type { BoardViewSnapshot } from "../resource-filesystem/resourcePresentation";

/** All layout mutations advance the board head in the same domain transaction. */
export async function readBoardViewSnapshot(repository: ObjectRepository, board: ObjectEnvelope, signal?: AbortSignal): Promise<BoardViewSnapshot> {
  const check = async () => {
    signal?.throwIfAborted();
    if ((await repository.resolveLatest(board.objectId)).revision !== board.revision) {
      throw new AgentAssetError("revision_unavailable", "此版本的白板布局已不可读取，请明确打开最新白板。已有卡片引用仍保留原版本。");
    }
  };
  await check();
  const placements = await repository.listPlacements(board.objectId);
  const edges = await repository.listEdges(board.objectId);
  const members: BoardViewSnapshot["members"] = [];
  for (const placement of placements) {
    signal?.throwIfAborted();
    const object = await repository.get(placement.ref);
    const path = liteasyPath(repository.scopeId, { kind: "object", ref: placement.ref });
    members.push({ placement, object, path, title: object.title, content: sourceContent({ text: objectText(object), path,
      revision: object.revision, scopeId: repository.scopeId }) });
  }
  await check();
  return { boardRef: refOf(board), sceneRevision: board.revision, members, edges };
}

export async function readFixedBoardScene(repository: ObjectRepository, board: ObjectEnvelope, selector: string, signal?: AbortSignal): Promise<BoardViewSnapshot> {
  const fixed = boardContextSnapshotSchema.parse(await repository.getSnapshot(selector.slice("board-context:".length)));
  if (fixed.scopeId !== repository.scopeId || fixed.boardRef.objectId !== board.objectId || fixed.boardRef.revision !== board.revision) throw new AgentAssetError("permission_denied", "白板选区不属于当前版本。");
  if (!fixed.placements || !fixed.edges) throw new AgentAssetError("revision_unavailable", "这个旧选区只保留了文字记录，无法还原空间预览。原记录仍可加入上下文。");
  const members: BoardViewSnapshot["members"] = [];
  for (const placement of fixed.placements) {
    signal?.throwIfAborted(); const object = await repository.get(placement.ref), path = liteasyPath(repository.scopeId, { kind: "object", ref: placement.ref });
    members.push({ placement, object, path, title: object.title, content: sourceContent({ text: objectText(object), path, revision: object.revision, scopeId: repository.scopeId }) });
  }
  signal?.throwIfAborted(); return { boardRef: fixed.boardRef, sceneRevision: fixed.boardRef.revision, members, edges: fixed.edges };
}
