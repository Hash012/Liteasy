import { useEffect, useState } from "react";
import type { ObjectRepository } from "../objects/objectRepository";
import { refOf } from "../objects/object.types";
import { subscribeObjectStorage } from "../objects/objectStorage";
import { defaultBlockPresentation, mergeBlockPresentation, type BlockPresentation, type BlockPresentationRecord } from "../objects/visualBlock.types";

export function useBlockPresentation(repository: ObjectRepository, boardId?: string, placementId?: string) {
  const empty = { version: null, value: defaultBlockPresentation };
  const [record, setRecord] = useState<BlockPresentationRecord>(empty);
  const [board, setBoard] = useState(defaultBlockPresentation);
  const [error, setError] = useState("");
  useEffect(() => {
    let generation = 0;
    let alive = true;
    setRecord(empty); setBoard(defaultBlockPresentation); setError("");
    const load = async () => {
      const current = ++generation;
      if (!boardId || !repository.getBlockPresentation) return;
      try {
        const [next, parent] = await Promise.all([
          repository.getBlockPresentation(boardId, placementId),
          placementId ? repository.getBlockPresentation(boardId) : Promise.resolve(empty),
        ]);
        if (alive && generation === current) { setRecord(next); setBoard(parent.value); setError(""); }
      } catch (e) { if (alive && generation === current) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    const unsubscribe = subscribeObjectStorage(repository.scopeId, (keys) => {
      if (!keys || keys.includes(`block-presentation/${boardId}/$board`) || keys.includes(`block-presentation/${boardId}/${placementId}`)) void load();
    });
    return () => { alive = false; unsubscribe(); };
  }, [repository, boardId, placementId]);
  return {
    record, error, value: mergeBlockPresentation(board, record.value),
    async save(value: BlockPresentation) {
      if (!boardId || error) throw new Error(error || "请先打开白板。");
      const current = await repository.resolveLatest(boardId);
      await repository.setBlockPresentation({ boardRef: refOf(current), placementId, expectedVersion: record.version, value, operationId: crypto.randomUUID() });
    },
  };
}
