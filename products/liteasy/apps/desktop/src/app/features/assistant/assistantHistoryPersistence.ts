import { researchSelectionSchema } from "../research-skills/researchDocument";
import { parseEvidenceReport } from "../evidence/evidenceReport";
import { parseResearchTask } from "../research-loop/researchLoop";
import { parseSavedAssistantAssetWrites } from "./assistantAssetWrites";
import { ObjectStoreError } from "../objects/object.types";
import { createObjectStorage, type ObjectStorage, type StorageChange, type StorageRow } from "../objects/objectStorage";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AssistantSessionDraft, AssistantSessionHistoryItem } from "./assistantSessionHistory";
import type { AssistantMessage } from "./assistant.types";
import { isQuickAskGenerationReceipt } from "../../../../../../packages/reading-core/src/quickAskValidation";

export const assistantHistoryStorageKey = "liteasy.assistant-history.v1";
export type AssistantHistorySnapshot = {
  version: "liteasy.assistant-history/v1";
  activeSessionId: string;
  sessions: AssistantSessionHistoryItem[];
  draft: AssistantSessionDraft;
  quarantined?: Array<{ path: string; value: unknown }>;
};
type Transport = { load(): Promise<unknown>; save(snapshot: AssistantHistorySnapshot): Promise<void> };
const emptyDraft = (): AssistantSessionDraft => ({ input: "", tokens: [], readerContexts: [] });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validDraft = (value: unknown): value is AssistantSessionDraft => record(value) && typeof value.input === "string" && Array.isArray(value.tokens) && Array.isArray(value.readerContexts) && (value.selectedResearchSkill === undefined || researchSelectionSchema.safeParse(value.selectedResearchSkill).success);

/** Recovery never guesses executor state or replays old authorization. Raw data is backed up before migration. */
export function parseAssistantHistory(value: unknown): AssistantHistorySnapshot | null {
  if (value === null || value === undefined) return null;
  if (!record(value) || value.version !== "liteasy.assistant-history/v1" || !Array.isArray(value.sessions) || typeof value.activeSessionId !== "string") {
    throw new Error("对话历史格式不兼容，原记录已保留，未用空会话覆盖。");
  }
  const quarantined: Array<{ path: string; value: unknown }> = Array.isArray(value.quarantined) ? [...value.quarantined] : [];
  const sessions: AssistantSessionHistoryItem[] = [];
  const ids = new Set<string>();
  value.sessions.forEach((candidate, index) => {
    if (!record(candidate) || typeof candidate.id !== "string" || ids.has(candidate.id) || typeof candidate.title !== "string" || !["qa", "command", "explain"].includes(String(candidate.mode)) || !Array.isArray(candidate.messages)) {
      quarantined.push({ path: `sessions[${index}]`, value: candidate });
      return;
    }
    ids.add(candidate.id);
    const messageIds = new Set<string>();
    const messages: AssistantMessage[] = [];
    candidate.messages.forEach((message, messageIndex) => {
      if (!record(message) || typeof message.id !== "string" || messageIds.has(message.id) || !["user", "assistant"].includes(String(message.role)) || typeof message.content !== "string") {
        quarantined.push({ path: `sessions[${index}].messages[${messageIndex}]`, value: message });
        return;
      }
      messageIds.add(message.id);
      if (message.quickAskSource !== undefined && (!record(message.quickAskSource) || typeof message.quickAskSource.excerpt !== "string" || typeof message.quickAskSource.paperTitle !== "string" || !isQuickAskGenerationReceipt(message.quickAskSource.receipt) || (candidate.scopeId !== undefined && candidate.scopeId !== message.quickAskSource.receipt.context.source.scopeId))) {
        quarantined.push({ path: `sessions[${index}].messages[${messageIndex}].quickAskSource`, value: message.quickAskSource });
        message = { ...message, quickAskSource: undefined };
      }
      const { confirmation: _expiredAuthorization, ...saved } = message as unknown as AssistantMessage;
      messages.push({ ...saved,
        assetWrites: parseSavedAssistantAssetWrites(saved.assetWrites),
        evidenceReport: parseEvidenceReport(saved.evidenceReport), researchLoop: parseResearchTask(saved.researchLoop),
        ...(saved.agentActivity?.status === "working" ? { agentActivity: { ...saved.agentActivity,
          status: "waiting", statusText: "运行状态待核对", connectionText: "尚未连接执行方" } } : {})
      });
    });
    const session = candidate as unknown as AssistantSessionHistoryItem;
    sessions.push({ ...session, messages,
      origin: session.origin ?? { kind: "legacy_unknown", entryPoint: "legacy", initiatedBy: { type: "import", id: session.scopeId ?? "local" } },
      status: session.status === "running" ? "unknown" : session.status,
      draft: validDraft(session.draft) ? session.draft : undefined,
      outbox: session.outbox?.map((intent) => intent.state === "pending" ? { ...intent, state: "needs_review" } : intent)
    });
  });
  return { version: "liteasy.assistant-history/v1", activeSessionId: value.activeSessionId,
    sessions, draft: validDraft(value.draft) ? value.draft : emptyDraft(), ...(quarantined.length ? { quarantined } : {}) };
}

export function createAssistantHistoryPersistence(transport?: Transport) {
  const native = isTauri();
  const activeTransport: Transport = transport ?? {
    load: async () => native ? invoke("load_assistant_history") : JSON.parse(localStorage.getItem(assistantHistoryStorageKey) ?? "null"),
    save: async (snapshot) => {
      if (native) await invoke("save_assistant_history", { snapshot });
      else localStorage.setItem(assistantHistoryStorageKey, JSON.stringify(snapshot));
    }
  };
  let loaded = false;
  let cached: AssistantHistorySnapshot | null = null;
  let loading: Promise<AssistantHistorySnapshot | null> | undefined;
  let queue = Promise.resolve();

  return {
    raw: () => activeTransport.load(),
    async load() {
      if (loaded) return cached ? structuredClone(cached) : null;
      loading ??= activeTransport.load().then((value) => {
        cached = parseAssistantHistory(value); loaded = true; return cached;
      }).finally(() => { loading = undefined; });
      return loading;
    },
    save(snapshot: AssistantHistorySnapshot) {
      if (!loaded) return Promise.reject(new Error("对话历史尚未读取，已阻止覆盖。"));
      cached = structuredClone(snapshot);
      // An acknowledgement belongs to this exact immutable snapshot. Coalescing
      // through `cached` could acknowledge a different target or revision.
      const savingSnapshot = structuredClone(snapshot);
      queue = queue.catch(() => {}).then(() => activeTransport.save(savingSnapshot));
      return queue;
    },
    flush() { return queue; },
    loadSession: undefined as ((id: string) => Promise<AssistantSessionHistoryItem | undefined>) | undefined
  };
}
export type AssistantHistoryPersistence = ReturnType<typeof createAssistantHistoryPersistence>;

type SessionIndex = Omit<AssistantSessionHistoryItem, "messages" | "draft" | "outbox" | "taskInput"> & { messageIds: string[] };
const prefix = "assistant/v2/";
const indexKey = (id: string) => `${prefix}session/${encodeURIComponent(id)}`;
const messageKey = (id: string, messageId: string) => `${prefix}message/${encodeURIComponent(id)}/${encodeURIComponent(messageId)}`;

/** Incremental records share the existing SQLite/IndexedDB transaction adapter.
 * Every CAS uses the revision this view actually loaded, never a freshly read revision with stale contents.
 */
export function createScopedAssistantHistoryPersistence(scopeId: string, currentScope: () => string, options: { storage?: ObjectStorage; viewId?: string } = {}) {
  const checkScope = () => { if (scopeId !== currentScope()) throw new ObjectStoreError("object_forbidden", "账号已切换，请重新打开。"); };
  const storage = options.storage ?? createObjectStorage(scopeId, currentScope);
  let defaultViewId: string;
  if (isTauri()) defaultViewId = getCurrentWindow().label;
  else {
    defaultViewId = sessionStorage.getItem("liteasy.assistant.view-id") ?? crypto.randomUUID();
    sessionStorage.setItem("liteasy.assistant.view-id", defaultViewId);
  }
  const viewId = options.viewId ?? defaultViewId;
  const viewKey = `${prefix}view/${encodeURIComponent(viewId)}`;
  const legacyKey = "assistant-history/current";
  const versions = new Map<string, StorageRow | null>();
  const indexes = new Map<string, SessionIndex>();
  const recoveryIssues: Array<{ path: string; value: unknown }> = [];
  const draftKey = (id: string) => `${prefix}draft/${encodeURIComponent(viewId)}/${encodeURIComponent(id)}`;
  const outboxKey = (id: string) => `${prefix}outbox/${encodeURIComponent(id)}`;
  const loadRow = async (key: string) => {
    const row = await storage.get(key); versions.set(key, row); return row;
  };
  const hydrate = async (index: SessionIndex): Promise<AssistantSessionHistoryItem> => {
    const messages: AssistantMessage[] = [];
    const quarantined: unknown[] = [];
    for (const id of index.messageIds) {
      const row = await loadRow(messageKey(index.id, id));
      if (row) messages.push(row.value as AssistantMessage);
      else { quarantined.push(id); recoveryIssues.push({ path: messageKey(index.id, id), value: { missing: true } }); }
    }
    const draft = (await loadRow(draftKey(index.id)))?.value;
    const outbox = (await loadRow(outboxKey(index.id)))?.value;
    const taskInput = index.taskBinding?.inputSnapshotId ? (await loadRow(index.taskBinding.inputSnapshotId))?.value : undefined;
    const parsed = parseAssistantHistory({ version: "liteasy.assistant-history/v1", activeSessionId: index.id,
      sessions: [{ ...index, messages, draft, outbox, taskInput }], draft: validDraft(draft) ? draft : emptyDraft() })!;
    if (parsed.quarantined?.length) recoveryIssues.push(...parsed.quarantined);
    return { ...parsed.sessions[0], messagesLoaded: true };
  };
  const changesFor = (snapshot: AssistantHistorySnapshot) => {
    const changes: StorageChange[] = [];
    const write = (key: string, value: unknown) => {
      const previous = versions.get(key) ?? null;
      if (previous && JSON.stringify(previous.value) === JSON.stringify(value)) return;
      changes.push({ key, expected: previous?.version ?? null, row: { key, version: crypto.randomUUID(), value } });
    };
    for (const session of snapshot.sessions) {
      if (session.kind !== "artifact_generation" && !session.messages.length && !session.draft?.input.trim() && !session.draft?.selectedResearchSkill && !session.draft?.tokens.length && !session.messageCount) continue;
      const { messages, draft, outbox, taskInput, messagesLoaded: _loaded, ...metadata } = session;
      const previousIndex = indexes.get(session.id);
      const index: SessionIndex = { ...metadata, scopeId,
        origin: session.origin ? { ...session.origin, initiatedBy: { ...session.origin.initiatedBy, id: scopeId } } : undefined,
        messageCount: session.messagesLoaded === false ? session.messageCount : messages.length,
        messageIds: session.messagesLoaded === false ? previousIndex?.messageIds ?? [] : messages.map((message) => message.id) };
      write(indexKey(session.id), index);
      if (session.messagesLoaded !== false) for (const message of messages) write(messageKey(session.id, message.id), message);
      if (taskInput && session.taskBinding?.inputSnapshotId) write(session.taskBinding.inputSnapshotId, taskInput);
      if (draft) write(draftKey(session.id), draft);
      if (outbox) write(outboxKey(session.id), outbox);
    }
    write(viewKey, { activeSessionId: snapshot.activeSessionId });
    return changes;
  };
  const commit = async (snapshot: AssistantHistorySnapshot) => {
    checkScope();
    if (recoveryIssues.length) throw new Error("部分历史记录不可读取，已进入只读保护，原数据可从备份导出。");
    const changes = changesFor(snapshot);
    if (!changes.length) return;
    // A send is a single transaction: message + frozen refs + outbox + draft + navigation metadata.
    await storage.commit(changes);
    for (const change of changes) {
      versions.set(change.key, change.row);
      if (change.key.startsWith(`${prefix}session/`)) indexes.set((change.row!.value as SessionIndex).id, change.row!.value as SessionIndex);
    }
  };
  const persistence = createAssistantHistoryPersistence({
    async load() {
      const markerKey = `${prefix}migration`;
      const marker = await loadRow(markerKey);
      if (!marker) {
        const previous = await storage.get(legacyKey);
        // The old reader is intentionally bypassed so backup preserves running/confirmation facts.
        const raw = previous?.value ?? (scopeId === "local" ? await createAssistantHistoryPersistence().raw() : null);
        if (raw !== null) {
          const backupKey = `${prefix}legacy-backup`;
          const backup = await storage.get(backupKey);
          if (!backup) await storage.commit([{ key: backupKey, expected: null, row: { key: backupKey, version: crypto.randomUUID(), value: raw } }]);
          const migrated = parseAssistantHistory(raw)!;
          for (const session of migrated.sessions) {
            const snapshot = { ...migrated, sessions: [{ ...session, messagesLoaded: true, draft: session.draft ?? (session.id === migrated.activeSessionId ? migrated.draft : emptyDraft()) }] };
            // Reentrant migration loads written records, avoiding duplicates after a process exit.
            await loadRow(indexKey(session.id));
            await loadRow(draftKey(session.id)); await loadRow(outboxKey(session.id)); await loadRow(viewKey);
            if (session.taskBinding?.inputSnapshotId) await loadRow(session.taskBinding.inputSnapshotId);
            for (const message of session.messages) await loadRow(messageKey(session.id, message.id));
            await commit(snapshot);
          }
          if (migrated.quarantined?.length) {
            const key = `${prefix}quarantine`;
            const row = await storage.get(key);
            if (!row) await storage.commit([{ key, expected: null, row: { key, version: crypto.randomUUID(), value: migrated.quarantined } }]);
          }
        }
        await storage.commit([{ key: markerKey, expected: null, row: { key: markerKey, version: crypto.randomUUID(), value: { version: 2, completed: true } } }]);
      } else if (!record(marker.value) || marker.value.version !== 2) throw new Error("历史版本不兼容，已阻止写入。");
      let after = "";
      while (true) {
        const rows = await storage.list(`${prefix}session/`, after, 1000);
        for (const row of rows) {
          versions.set(row.key, row);
          if (!record(row.value) || typeof row.value.id !== "string" || typeof row.value.title !== "string" || !["qa", "command", "explain"].includes(String(row.value.mode)) || !Array.isArray(row.value.messageIds) || !row.value.messageIds.every((id) => typeof id === "string") || row.key !== indexKey(row.value.id)) {
            recoveryIssues.push({ path: row.key, value: row.value }); continue;
          }
          indexes.set(row.value.id, row.value as SessionIndex);
        }
        if (rows.length < 1000) break;
        after = rows.at(-1)!.key;
      }
      const view = (await loadRow(viewKey))?.value as { activeSessionId?: string } | undefined;
      const active = view?.activeSessionId && indexes.has(view.activeSessionId) ? view.activeSessionId : indexes.keys().next().value ?? "";
      const sessions: AssistantSessionHistoryItem[] = [];
      for (const index of indexes.values()) {
        sessions.push(index.id === active ? await hydrate(index) : { ...index, messages: [], messagesLoaded: false });
      }
      const quarantine = await storage.get(`${prefix}quarantine`);
      if (!sessions.length && !Array.isArray(quarantine?.value) && !recoveryIssues.length) return null;
      return { version: "liteasy.assistant-history/v1", activeSessionId: active, sessions,
        draft: sessions.find((session) => session.id === active)?.draft ?? emptyDraft(), quarantined: [...(Array.isArray(quarantine?.value) ? quarantine.value : []), ...recoveryIssues] };
    },
    save: commit
  });
  const load = persistence.load;
  persistence.load = async () => { checkScope(); const value = await load(); checkScope(); return value; };
  persistence.loadSession = async (id) => { checkScope(); const value = indexes.has(id) ? await hydrate(indexes.get(id)!) : undefined; checkScope(); return value; };
  return persistence;
}
