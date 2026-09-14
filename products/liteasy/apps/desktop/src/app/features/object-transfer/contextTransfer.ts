import { OBJECT_TRANSFER_MIME, PENDING_CAPTURE_MIME } from "./objectTransfer";
import type { ObjectRef } from "../objects/object.types";
import type { Paper } from "../workspace/workspace.types";

export const PAPER_CONTEXT_MIME = "application/x-liteasy-paper-context";
export const LIBRARY_RESOURCE_MIME = "application/x-liteasy-library-resource-v2";

export type ResourceContextAttachment = {
  ref: ObjectRef;
  refs: ObjectRef[];
  title: string;
  kind: string;
  detail?: string;
};

export function hasResourceContextTransfer(data: Pick<DataTransfer, "types">) {
  return [OBJECT_TRANSFER_MIME, PENDING_CAPTURE_MIME, PAPER_CONTEXT_MIME, LIBRARY_RESOURCE_MIME]
    .some((type) => data.types.includes(type));
}

/** A drag supplies a locator only; resolve it against this workspace's papers. */
export function readContextPaper(data: Pick<DataTransfer, "getData">, papers: Paper[]) {
  let id = data.getData(PAPER_CONTEXT_MIME);
  if (!id) {
    const raw = data.getData(LIBRARY_RESOURCE_MIME);
    if (!raw) return null;
    if (raw.length > 200_000) throw new Error("拖入内容过大。");
    const value = JSON.parse(raw);
    if (value?.type === "folder" || value?.folder) throw new Error("请拖入具体论文。");
    id = value?.area === "local" ? value?.entry?.id : value?.entry?.paperId;
  }
  if (!id) throw new Error("请先在文献库中打开这篇论文，再加入对话。");
  const paper = papers.find((candidate) => candidate.id === id);
  if (!paper) throw new Error("这篇论文在当前工作区不可用。");
  return paper;
}
