import { z } from "zod";

export const resourceIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/);
export const resourceRefSchema = z.strictObject({
  providerId: resourceIdentifierSchema,
  resourceId: resourceIdentifierSchema,
  scopeId: resourceIdentifierSchema,
  revision: z.string().min(1).max(200).optional()
});
export type ResourceRef = z.infer<typeof resourceRefSchema>;
export type ResourceScope = { id: string; kind: "device" | "account" | "library" };
export type ResourceRepresentation = "markdown" | "native";
export type ResourceAddress = ResourceRef | string;
export type ResourceStat = {
  protocolVersion: "liteasy.resource-file/v1";
  canonicalRef: ResourceRef & { revision: string };
  canonicalUri: string;
  title: string;
  kind: string;
  scope: ResourceScope;
  availability: "available";
  versioning: "snapshot_required" | "immutable" | "ephemeral";
  effectiveCapabilities: readonly ("stat" | "list" | "read" | "save")[];
  files: Array<{ representation: ResourceRepresentation; fileName: string; mediaType: string; byteLength: number }>;
};
export type ResourceListOptions = { cursor?: string; limit?: number; signal?: AbortSignal };
export type ResourceListResult = { entries: ResourceStat[]; nextCursor?: string; consistency: "latest" };
export type ResourceReadOptions = {
  representation: ResourceRepresentation;
  maxBytes: number;
  signal?: AbortSignal;
};
export type ResourceReadResult = {
  resource: ResourceStat;
  representation: ResourceRepresentation;
  fileName: string;
  mediaType: string;
  byteLength: number;
  encoding: "utf8";
  content: string;
};

/** Registered application code owns providers; resource contents cannot register one. */
export type ResourceProvider = {
  providerId: string;
  scope: ResourceScope;
  getCurrentScopeId?: () => string;
  stat(ref: ResourceRef, options?: { signal?: AbortSignal }): Promise<ResourceStat>;
  list(options?: ResourceListOptions): Promise<ResourceListResult>;
  read(ref: ResourceRef, options: ResourceReadOptions): Promise<ResourceReadResult>;
};

export type ResourceFileErrorCode =
  | "invalid_ref" | "provider_unavailable" | "resource_unavailable" | "scope_changed"
  | "revision_unavailable" | "invalid_cursor" | "read_limit_exceeded" | "invalid_content"
  | "unsupported_representation";

export class ResourceFileError extends Error {
  constructor(readonly code: ResourceFileErrorCode, message: string) {
    super(message);
    this.name = "ResourceFileError";
  }
}
