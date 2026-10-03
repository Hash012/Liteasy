import type { ResourceContextAttachment } from "../object-transfer/contextTransfer";
import type { ModelImageInput } from "../models/modelImages";

export type AgentAssetCapability = "search" | "read" | "write" | "add_context";
/** Paths identify assets; capabilities come from trusted application adapters. */
export type AgentAsset = {
  path: string;
  title: string;
  kind: string;
  revision?: string;
  capabilities: AgentAssetCapability[];
  summary?: string;
  relatedPaperIds?: string[];
  /** Trusted adapter source provenance; not an authorization supplied by a model. */
  sourceReferences?: Array<NonNullable<import("../workspace/workspace.types").Paper["libraryReference"]>>;
  structuredType?: { id: string; version: string };
};
export type AgentAssetSearch = { query: string; limit?: number; signal?: AbortSignal };
export type AgentAssetReadOptions = { offset?: number; maxCharacters?: number; signal?: AbortSignal };
export type AgentAssetRead = {
  asset: AgentAsset;
  text: string;
  offset: number;
  totalCharacters: number;
  truncated: boolean;
  nextOffset?: number;
  /** Trusted adapter provenance; absence does not prove source text or full coverage. */
  evidence?: { kind: "source" | "user" | "derived" | "metadata"; coverage: "partial" | "unknown"; reason?: string };
};
export type AgentAssetWriteOptions = {
  text: string;
  expectedRevision: string;
  mode?: "replace" | "append";
  signal?: AbortSignal;
};
export type AgentAssetWriteReceipt = {
  asset: AgentAsset;
  previousRevision: string;
  changed: boolean;
  addedLines: number;
  removedLines: number;
  warnings?: string[];
};
export type AgentAssetCreate = {
  kind: "note" | "board";
  title: string;
  text?: string;
  paperPath?: string;
  operationId: string;
  signal?: AbortSignal;
};

/** Register a trusted adapter to add asset kinds without changing model tools. */
export type AgentAssetAdapter = {
  id: string;
  accepts(path: string): boolean;
  search(input: AgentAssetSearch): Promise<AgentAsset[]>;
  stat(path: string, options?: { signal?: AbortSignal }): Promise<AgentAsset>;
  read(path: string, options: AgentAssetReadOptions): Promise<AgentAssetRead>;
  resolveRelativeImages?(path: string, relativePath: string, options?: { signal?: AbortSignal }): Promise<ModelImageInput[]>;
  resolveImages?(path: string, options?: { signal?: AbortSignal }): Promise<ModelImageInput[]>;
  write?(path: string, input: AgentAssetWriteOptions): Promise<AgentAssetWriteReceipt>;
  context?(path: string): Promise<ResourceContextAttachment[]>;
};

export class AgentAssetError extends Error {
  constructor(readonly code: "invalid_path" | "unavailable" | "scope_changed" | "read_only" | "revision_conflict" | "invalid_request", message: string) {
    super(message);
    this.name = "AgentAssetError";
  }
}
