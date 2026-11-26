export type ContextKind = "profile" | "understanding" | "progress" | "idea" | "group_background" | "reference";
export type ContextSourceRef = {
  provider: "liteasy" | "zotero" | "web" | "user" | "import" | "other";
  origin: string; sourceId?: string; title?: string; revision?: string | null;
  contentHash?: string; locator?: string; capturedAt?: string;
  availability?: "remote" | "local_only" | "unknown" | "unavailable";
  nativeRef?: { providerId: string; resourceId: string; scopeId: string; revision?: string } | { objectId: string; revision: string; selectorId?: string };
};
export type ContextEntryInput = {
  scopeKey: string; kind: ContextKind; title: string; bodyMarkdown: string;
  basis: "user_authored" | "user_statement" | "agent_summary" | "source_excerpt" | "imported";
  status?: "active" | "draft" | "archived"; tags?: string[]; sourceRefs?: ContextSourceRef[]; attributes?: Record<string, unknown>;
};
export type ContextEntry = Required<ContextEntryInput> & {
  schemaVersion: "liteasy.context-entry/v1"; id: string; revision: number;
  owner: string; actor: string; createdAt: string; updatedAt: string;
};
type WriteBase = { schemaVersion: "liteasy.context-write/v1"; operationId: string };
export type ContextWrite = WriteBase & (
  { action: "create"; entry: ContextEntryInput } |
  { action: "update"; entryId: string; expectedRevision: number; entry: ContextEntryInput } |
  { action: "delete"; entryId: string; expectedRevision: number }
);
export type ContextReceipt = {
  schemaVersion: "liteasy.context-api/v1"; operationId: string; entryId: string; revision: number;
  action: "create" | "update" | "delete"; scopeKey: string; committedAt: string; expiresAt: string;
};
export type ContextGrantInput = { name: string; readScopes: string[]; writeScopes: string[]; expiresAt: string };
export type ContextGrant = ContextGrantInput & { id: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };
export type ContextWhoami = {
  schemaVersion: "liteasy.context-api/v1"; subject: string; actor: string;
  readScopes: string[]; writeScopes: string[]; expiresAt: string | null; idempotencyWindowSeconds: number;
};
export type ContextFilters = { scopes?: string[]; kinds?: ContextKind[]; tags?: string[]; query?: string; status?: string; limit?: number; cursor?: string };
export type ContextQuery = {
  schemaVersion: "liteasy.context-api/v1"; selectedEntries: ContextEntry[];
  filters: ContextFilters;
  omitted: { id: string; revision: number; scopeKey: string; kind: ContextKind; title: string; length: number; reason: "budget" }[];
  generatedAt: string; budget: { maxChars: number; usedChars: number; unit: "unicode_code_point" }; nextCursor: string | null;
};
export type ContextTransport = (request: { url: string; method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
export const contextApiVersion: "liteasy.context-api/v1";
export class ContextClientError extends Error { code: string; status: number; retryable: boolean; requestId?: string; currentRevision?: number; }
export function normalizeContextOrigin(value: string): string;
export const fetchContextTransport: ContextTransport;
export class ContextClient {
  constructor(options: { origin: string; token: string | (() => string | Promise<string>); transport?: ContextTransport; timeoutMs?: number });
  origin: string;
  whoami(): Promise<ContextWhoami>;
  write(input: ContextWrite): Promise<ContextReceipt>;
  get(id: string): Promise<{ schemaVersion: string; entry: ContextEntry }>;
  operation(id: string): Promise<ContextReceipt>;
  list(filters?: ContextFilters): Promise<{ schemaVersion: string; entries: ContextEntry[]; nextCursor: string | null }>;
  history(id: string, filters?: Pick<ContextFilters, "cursor" | "limit">): Promise<{ schemaVersion: string; revisions: ContextEntry[]; nextCursor: string | null }>;
  query(input: ContextFilters & { schemaVersion: "liteasy.context-api/v1"; maxChars: number }): Promise<ContextQuery>;
  grants(): Promise<{ schemaVersion: string; grants: ContextGrant[] }>;
  createGrant(input: ContextGrantInput): Promise<{ schemaVersion: string; grant: ContextGrant; secret: string }>;
  revokeGrant(id: string): Promise<{ schemaVersion: string; revoked: true }>;
}
