import { useEffect, useMemo, useRef, useState } from "react";
import { createSettingsStore } from "../settings/settings.store";
import type { QuickAskPresetSnapshot } from "../settings/quickAskPresetSettings";
import { builtInQuickAskPresets } from "./quickAskPresets";

export function useQuickAskPresets({ scopeId, settingsStore }: { scopeId: string; settingsStore?: ReturnType<typeof createSettingsStore> }) {
  const currentScope = useRef(scopeId); currentScope.current = scopeId;
  const store = useMemo(() => settingsStore ?? createSettingsStore(), [settingsStore]);
  const repository = useMemo(() => store.quickAsk(scopeId, () => currentScope.current === scopeId), [scopeId, store]);
  const [version, setVersion] = useState(0);
  const [selection, setSelection] = useState<{ scopeId: string; id: string }>();
  const [operationError, setOperationError] = useState<{ scopeId: string; text: string }>();
  useEffect(() => repository.subscribe(() => setVersion(value => value + 1)), [repository]);
  const result = useMemo(() => {
    try { return { snapshot: repository.read(), error: "" }; }
    catch (cause) { return { snapshot: undefined, error: cause instanceof Error ? cause.message : "无法读取快捷指令，已保存内容没有被覆盖。" }; }
  }, [repository, version]);
  const presets = [...(result.snapshot?.presets ?? builtInQuickAskPresets(scopeId))].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const requested = selection?.scopeId === scopeId ? selection.id : result.snapshot?.lastPresetId ?? "explain";
  const selectedPreset = presets.find(item => item.id === requested) ?? presets.find(item => item.id === "explain")!;
  const fallbackNotice = selectedPreset.id !== requested ? "上次选择的快捷指令已不可用，已切换为讲清楚。" : "";
  return {
    repository, presets, selectedPreset, snapshot: result.snapshot as QuickAskPresetSnapshot | undefined,
    error: result.error || (operationError?.scopeId === scopeId ? operationError.text : ""), fallbackNotice,
    selectPreset(id: string) { if (presets.some(item => item.id === id)) setSelection({ scopeId, id }); },
    async markCompleted(id: string) {
      try { await repository.markCompleted(id, repository.read().revision); setOperationError(undefined); }
      catch (cause) { setOperationError({ scopeId, text: cause instanceof Error ? cause.message : "最近任务未保存。" }); }
    },
    refresh() { setVersion(value => value + 1); },
  };
}
