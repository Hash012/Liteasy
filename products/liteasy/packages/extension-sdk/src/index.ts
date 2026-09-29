/** Transport-neutral contracts. The host supplies identity and grants; callers cannot. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ResourcePath = `liteasy://${string}`;
export type Disposable = { dispose(): void };
export type ExtensionTransport = (request: { apiVersion: "2.0.0"; requestId: string; tool: string; arguments: Record<string, Json> }, signal?: AbortSignal) => Promise<Json>;
export function createExtensionClient(transport: ExtensionTransport) {
  const call = (tool: string, args: Record<string, Json> = {}, signal?: AbortSignal) => transport({ apiVersion: "2.0.0", requestId: crypto.randomUUID(), tool, arguments: args }, signal);
  return {
    catalog: (signal?: AbortSignal) => call("liteasy_extension_catalog", {}, signal),
    skills: (id?: string) => call("liteasy_skills", id ? { id } : {}),
    drafts: () => call("liteasy_extension_drafts"),
    readDraft: (id: string) => call("liteasy_extension_draft", { id }),
    createDraft: (title: string, files?: Record<string, string>) => call("liteasy_extension_create", { title, ...(files ? { files } : {}) }),
    patchDraft: (id: string, expectedRevision: string, changes: Array<{ path: string; text: string | null }>) => call("liteasy_extension_patch", { id, expectedRevision, changes }),
    validate: (id: string) => call("liteasy_extension_validate", { id }),
    trial: (id: string, signal?: AbortSignal) => call("liteasy_extension_trial", { id }, signal),
    export: (id: string) => call("liteasy_extension_export", { id }),
    runs: () => call("liteasy_workflow_runs"),
    replay: (id: string) => call("liteasy_workflow_replay", { id }),
  };
}
