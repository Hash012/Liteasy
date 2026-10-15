import type { ContentFragment } from "../markdown/contentFragment";
import type { BoardConnection, ObjectEnvelope, ObjectRef, Placement } from "../objects/object.types";
import type { AgentAsset, AgentAssetAdapter, AgentAssetRead, AgentAssetReadOptions } from "./agentAsset.types";

export type PresentationIntent = "self" | "source";
export type PresentationOptions = AgentAssetReadOptions & { intent?: PresentationIntent };
export type BoardViewSnapshot = {
  boardRef: ObjectRef;
  sceneRevision: string;
  members: Array<{ placement: Placement; object?: ObjectEnvelope; content: ContentFragment; title: string; path: string }>;
  edges: BoardConnection[];
};
export type ResourcePresentation =
  | { kind: "content"; asset: AgentAsset; read: AgentAssetRead & { content: ContentFragment } }
  | { kind: "board"; asset: AgentAsset; scene: BoardViewSnapshot }
  | { kind: "pdf"; asset: AgentAsset; path: string; intent: PresentationIntent }
  | { kind: "image"; asset: AgentAsset; path: string }
  | { kind: "unavailable"; asset: AgentAsset; code: "not_supported" | "not_prepared" | "revision_unavailable"; message: string; retryable: boolean };

/** For explicitly registered text projections only. Native bytes never acquire Markdown semantics. */
export function contentPresentation(source: Pick<AgentAssetAdapter, "stat" | "read">): NonNullable<AgentAssetAdapter["present"]> {
  return async (path, options) => {
    const asset = await source.stat(path, options);
    if (options.intent === "source") return { kind: "pdf", asset, path, intent: "source" };
    if (asset.kind === "workspace.board" || /\.canvas(?:[?#]|$)/i.test(path)) return { kind: "unavailable", asset, code: "not_supported", message: "此白板尚未提供空间预览，请打开原板。", retryable: false };
    const read = await source.read(path, options);
    if (!read.content) return { kind: "unavailable", asset, code: "not_supported", message: "此资源尚未提供可预览的正文，请打开原文件。", retryable: false };
    return { kind: "content", asset: read.asset, read: { ...read, content: read.content } };
  };
}
