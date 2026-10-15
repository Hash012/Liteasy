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
