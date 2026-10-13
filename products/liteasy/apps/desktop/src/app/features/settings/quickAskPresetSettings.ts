import { builtInQuickAskPresets, QUICK_ASK_PRESET_SCHEMA, validateQuickAskInstruction, validateQuickAskPreset, type QuickAskPreset } from "../quick-ask-presets/quickAskPresets";

const schema = "liteasy.quick-ask-settings/v1" as const;
const eventName = "liteasy-quick-ask-settings-changed";
export type QuickAskPresetSnapshot = { schema: typeof schema; instructionUnit: "utf16"; scopeId: string; revision: string; presets: QuickAskPreset[]; lastPresetId: string };
export type QuickAskPresetSaveReceipt = { revision: string; committedAt: string; preset?: QuickAskPreset };
export type QuickAskPresetWrite = { id?: string; expectedRevision?: string; name: string; instruction: string; allowDuplicateName?: boolean };
const empty = (scopeId: string): QuickAskPresetSnapshot => ({ schema, instructionUnit: "utf16", scopeId, revision: "initial", presets: builtInQuickAskPresets(scopeId), lastPresetId: "explain" });
function validateSnapshot(value: unknown, scopeId?: string): QuickAskPresetSnapshot {
  const data = value as QuickAskPresetSnapshot;
  if (!data || data.schema !== schema || data.instructionUnit !== "utf16") throw new Error("不支持的快捷指令设置版本；原始内容未修改。");
  if (typeof data.scopeId !== "string" || !data.scopeId || (scopeId !== undefined && data.scopeId !== scopeId) || typeof data.revision !== "string" || !data.revision ||
    typeof data.lastPresetId !== "string" || !Array.isArray(data.presets) || data.presets.length > 500) throw new Error("快捷指令设置或账号范围无效。");
  const presets = data.presets.map(validateQuickAskPreset);
  if (new Set(presets.map(item => item.id)).size !== presets.length || presets.some(item => item.scopeId !== data.scopeId)) throw new Error("快捷指令标识重复或账号范围不匹配。");
  const builtins = builtInQuickAskPresets(data.scopeId);
  if (builtins.some(builtin => !presets.some(item => item.id === builtin.id && item.builtIn && item.instruction === builtin.instruction && item.name === builtin.name && item.revision === builtin.revision)) || presets.some(item => item.builtIn && !builtins.some(builtin => builtin.id === item.id))) throw new Error("内置快捷指令不可改写。");
  if (presets.filter(item => item.pinned).length > 4) throw new Error("最多置顶四个快捷指令。");
  return { schema, instructionUnit: "utf16", scopeId: data.scopeId, revision: data.revision, presets, lastPresetId: data.lastPresetId };
}
/** Domain owned extension of settings.store. This is the sole persistent preset body, never a UI cache. */
export function createQuickAskPresetSettings(scopeId: string, active: () => boolean = () => true) {
  if (!scopeId || scopeId.length > 2048) throw new Error("快捷指令需要明确的账号范围。");
  const key = `liteasy.settings.quick-ask.v1:${encodeURIComponent(scopeId)}`;
  const check = () => { if (!active()) throw new Error("账号已切换，旧快捷指令操作已取消。"); };
  function read(): QuickAskPresetSnapshot {
    check();
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? validateSnapshot(JSON.parse(raw), scopeId) : empty(scopeId);
  }
  async function commit(expectedRevision: string, update: (snapshot: QuickAskPresetSnapshot) => QuickAskPreset | void): Promise<QuickAskPresetSaveReceipt> {
    const write = () => {
      check(); const next = read();
      if (next.revision !== expectedRevision) throw new Error("快捷指令已被其他窗口修改，请刷新后重试；当前草稿已保留。");
      const preset = update(next);
      next.revision = crypto.randomUUID();
      validateSnapshot(next, scopeId); check();
      if (!globalThis.localStorage) throw new Error("设置存储不可用，快捷指令尚未保存；当前草稿已保留。");
      // Publish only after durable storage succeeds; quota/security failures must not look saved.
      globalThis.localStorage.setItem(key, JSON.stringify(next));
      globalThis.dispatchEvent?.(new CustomEvent(eventName, { detail: scopeId }));
      return { revision: next.revision, committedAt: new Date().toISOString(), ...(preset ? { preset: { ...preset } } : {}) };
    };
    return globalThis.navigator?.locks ? navigator.locks.request(key, write) : write();
  }
  return {
    scopeId, read,
    subscribe(listener: () => void) {
      const local = (event: Event) => { if ((event as CustomEvent).detail === scopeId) listener(); };
      const external = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
      globalThis.addEventListener?.(eventName, local); globalThis.addEventListener?.("storage", external);
      return () => { globalThis.removeEventListener?.(eventName, local); globalThis.removeEventListener?.("storage", external); };
    },
    save(input: QuickAskPresetWrite, expectedRevision: string) {
      validateQuickAskInstruction(input.instruction);
      if (!input.name.trim() || input.name.trim().length > 80 || !input.instruction.trim()) throw new Error("请填写名称（最多 80 字符）和完整指令。");
      return commit(expectedRevision, snapshot => {
        const old = input.id ? snapshot.presets.find(item => item.id === input.id) : undefined;
        if (input.id && !old) throw new Error("快捷指令已删除；当前草稿已保留。");
        if (old && input.expectedRevision !== old.revision) throw new Error("快捷指令版本已变化；当前草稿已保留。");
        const id = old && !old.builtIn ? old.id : crypto.randomUUID();
        if (!input.allowDuplicateName && snapshot.presets.some(item => item.id !== id && item.name.trim().toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) throw new Error("已有同名快捷指令，请修改名称或明确选择保留同名。");
        const now = new Date().toISOString();
        const preset: QuickAskPreset = { schema: QUICK_ASK_PRESET_SCHEMA, id, scopeId, name: input.name.trim(), instruction: input.instruction,
          builtIn: false, owned: true, revision: crypto.randomUUID(), pinned: old && !old.builtIn ? old.pinned : false,
          order: old && !old.builtIn ? old.order : Math.max(-1, ...snapshot.presets.map(item => item.order)) + 1,
          createdAt: old && !old.builtIn ? old.createdAt : now, updatedAt: now };
        snapshot.presets = [...snapshot.presets.filter(item => item.id !== id), preset]; return preset;
      });
    },
    remove(id: string, expectedRevision: string) { return commit(expectedRevision, snapshot => {
      const preset = snapshot.presets.find(item => item.id === id);
      if (!preset || preset.builtIn) throw new Error("内置快捷指令不可删除。");
      snapshot.presets = snapshot.presets.filter(item => item.id !== id);
      // Keep the missing last id until the next success, so reopen can explain its fallback.
    }); },
    setPinned(id: string, pinned: boolean, expectedRevision: string) { return commit(expectedRevision, snapshot => {
      const preset = snapshot.presets.find(item => item.id === id); if (!preset) throw new Error("快捷指令已删除。");
      if (pinned && !preset.pinned && snapshot.presets.filter(item => item.pinned).length >= 4) throw new Error("最多置顶四个快捷指令，请先取消其他任务的置顶。");
      preset.pinned = pinned;
    }); },
    move(id: string, direction: -1 | 1, expectedRevision: string) { return commit(expectedRevision, snapshot => {
      const sorted = [...snapshot.presets].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const index = sorted.findIndex(item => item.id === id); const next = index + direction;
      if (index < 0 || next < 0 || next >= sorted.length) return;
      [sorted[index], sorted[next]] = [sorted[next], sorted[index]];
      sorted.forEach((item, order) => { item.order = order; });
    }); },
    markCompleted(id: string, expectedRevision: string) { return commit(expectedRevision, snapshot => {
      if (!snapshot.presets.some(item => item.id === id)) throw new Error("已完成的任务预设已删除，下次使用讲清楚。");
      snapshot.lastPresetId = id;
    }); },
    exportJson() { return JSON.stringify(read(), null, 2); },
    importJson(text: string, expectedRevision: string) {
      if (text.length > 4_000_000) throw new Error("导入文件过大；原始内容已保留。");
      const parsed = JSON.parse(text);
      const imported = parsed?.schema === QUICK_ASK_PRESET_SCHEMA ? { presets: [validateQuickAskPreset(parsed)] } : validateSnapshot(parsed);
      return commit(expectedRevision, snapshot => {
        // Explicit import copies owned text into the current account; no foreign IDs or ownership leak.
        const now = new Date().toISOString();
        const copies = imported.presets.filter(item => !item.builtIn).map(item => ({ ...item, id: crypto.randomUUID(), scopeId, revision: crypto.randomUUID(), pinned: false,
          order: Math.max(-1, ...snapshot.presets.map(preset => preset.order)) + 1 + imported.presets.indexOf(item), createdAt: now, updatedAt: now }));
        if (snapshot.presets.length + copies.length > 500) throw new Error("快捷指令数量超过 500 项，请先整理后再导入。");
        snapshot.presets.push(...copies);
      });
    },
  };
}
export type QuickAskPresetRepository = ReturnType<typeof createQuickAskPresetSettings>;
