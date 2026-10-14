import type { ObjectRepository } from "../objects/objectRepository";
import type { ObjectEnvelope, ObjectRef } from "../objects/object.types";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import type { Paper } from "../workspace/workspace.types";
import { splitReference } from "./referenceText";

export type ReferencePdf = { bytes: Uint8Array; path: string; page: number };

/** Resolve only source documents and their fragments, never a derived note's ancestors. */
export async function resolveReferencePdf(input: {
  path: string; repository: ObjectRepository; papers: readonly Paper[]; signal?: AbortSignal;
}): Promise<{ paper: Paper; path: string; page: number } | undefined> {
  const { target: locator, fragment } = splitReference(input.path);
  let target;
  try { target = parseLiteasyPath(locator, input.repository.scopeId); }
  catch (error) {
    // Other registered resource adapters can retain their existing content preview.
    if (!/^liteasy:\/\/(papers|objects|paper-annotations)\//.test(locator)) return undefined;
    throw error;
  }
  const requestedPage = /^(?:page=|p\.?)(\d+)$/.exec(fragment)?.[1]
    ?? (target.kind === "object" ? /^page:(\d+)$/.exec(target.ref.selectorId ?? "")?.[1] : undefined);
  let page = requestedPage ? Number(requestedPage) : 1;
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("引用页码无效。");
  let paperId: string | undefined, documentHash: string | undefined;
  const visited = new Set<string>();
  async function source(object: ObjectEnvelope, depth = 0): Promise<void> {
    input.signal?.throwIfAborted();
    if (depth > 4 || visited.has(object.objectId)) return;
    visited.add(object.objectId);
    if (object.kind === "source.document") {
      paperId = object.content.payload.paperId;
      documentHash = object.content.payload.documentHash;
    } else if (object.kind === "content.fragment") {
      const anchor = object.content.payload.anchors.find(value => value.type === "pdf") ?? object.content.payload.anchors.find(value => value.type === "text");
      if (anchor) {
        if (anchor.type === "pdf" && !requestedPage) page = anchor.page;
        await source(await input.repository.get(anchor.sourceRef as ObjectRef), depth + 1);
      }
    }
  }
  if (target.kind === "paper" || target.kind === "pdf-annotation") paperId = target.paperId;
  else if (target.kind === "object") await source(target.followLatest
    ? await input.repository.resolveLatest(target.ref.objectId) : await input.repository.get(target.ref));
  else return undefined;
  input.signal?.throwIfAborted();
  if (!paperId) return undefined;
  const paper = input.papers.find(value => value.id === paperId);
  if (!paper) {
    if (target.kind === "paper" || target.kind === "pdf-annotation") throw new Error("原始 PDF 已不在当前文献库中，请重新导入文件。");
    return undefined;
  }
  if (!paper.sourcePath) throw new Error("未找到原始 PDF 文件，请在文献库中重新关联文件。");
  if (documentHash && paper.contentHash && documentHash !== paper.contentHash) throw new Error("原始 PDF 已更换，无法按旧引用预览。请重新选择来源。");
  return { paper, path: liteasyPath(input.repository.scopeId, { kind: "paper", paperId }), page: Math.max(1, page) };
}
