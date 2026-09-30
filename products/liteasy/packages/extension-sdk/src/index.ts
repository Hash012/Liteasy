/** Transport-neutral contracts. The host supplies identity and grants; callers cannot. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ResourcePath = `liteasy://${string}`;
export type Disposable = { dispose(): void };
export type ExtensionTransport = (request: { apiVersion: "2.0.0"; requestId: string; tool: string; arguments: Record<string, Json> }, signal?: AbortSignal) => Promise<Json>;
export function createExtensionClient(transport: ExtensionTransport) {
  const call = (tool: string, args: Record<string, Json> = {}, signal?: AbortSignal) => transport({ apiVersion: "2.0.0", requestId: crypto.randomUUID(), tool, arguments: args }, signal);
  return {
    catalog: (signal?: AbortSignal) => call("liteasy_extension_catalog", {}, signal),
    describe: (kind: "component" | "block" | "operation" | "manifest" | "workflow", id?: string) => call("liteasy_extension_catalog", { kind, ...(id ? { id } : {}) }),
    skills: (id?: string) => call("liteasy_skills", id ? { id } : {}),
    resources: {
      search: (query = "", limit = 50, signal?: AbortSignal) => call("liteasy_search", { query, limit }, signal),
      stat: (path: ResourcePath, signal?: AbortSignal) => call("liteasy_stat", { path }, signal),
      read: (path: ResourcePath, offset = 0, maxCharacters = 12000, signal?: AbortSignal) => call("liteasy_read", { path, offset, maxCharacters }, signal),
      image: (path: ResourcePath, index = 0, signal?: AbortSignal) => call("liteasy_read_image", { path, index }, signal),
      create: (options: { kind: "note" | "board"; title: string; operationId: string; text?: string; paperPath?: ResourcePath }, signal?: AbortSignal) => call("liteasy_create", { ...options }, signal),
      write: (options: { path: ResourcePath; text: string; expectedRevision: string; mode: "append" | "replace" }, signal?: AbortSignal) => call("liteasy_write", { ...options }, signal),
    },
    blocks: {
      read: (path: ResourcePath, signal?: AbortSignal) => call("liteasy_block_read", { path }, signal),
      create: (options: { title: string; typeId: string; typeVersion: string; data: Record<string, Json>; operationId: string; boardPath?: ResourcePath; x?: number; y?: number }, signal?: AbortSignal) => call("liteasy_block_create", { ...options }, signal),
      update: (options: { path: ResourcePath; expectedRevision: string; title: string; data: Record<string, Json>; operationId: string }, signal?: AbortSignal) => call("liteasy_block_update", { ...options }, signal),
    },

    drafts: () => call("liteasy_extension_drafts"),
    readDraft: (id: string) => call("liteasy_extension_draft", { id }),
    createDraft: (title: string, files?: Record<string, string>) => call("liteasy_extension_create", { title, ...(files ? { files } : {}) }),
    patchDraft: (id: string, expectedRevision: string, changes: Array<{ path: string; text: string | null }>) => call("liteasy_extension_patch", { id, expectedRevision, changes }),
    validate: (id: string) => call("liteasy_extension_validate", { id }),
    trial: (id: string, signal?: AbortSignal) => call("liteasy_extension_trial", { id }, signal),
    export: (id: string) => call("liteasy_extension_export", { id }),
    runs: () => call("liteasy_workflow_runs"),
    requestWorkflow: (owner: string, workflow: string, selection: ResourcePath[] = []) => call("liteasy_workflow_request", { owner, workflow, selection }),
    inspectRun: (id: string) => call("liteasy_workflow_inspect", { id }),
    controlRun: (id: string, action: "pause" | "resume" | "cancel", signal?: AbortSignal) => call("liteasy_workflow_control", { id, action }, signal),
    recompute: (id: string) => call("liteasy_workflow_recompute", { id }),
    replay: (id: string) => call("liteasy_workflow_replay", { id }),
  };
}
