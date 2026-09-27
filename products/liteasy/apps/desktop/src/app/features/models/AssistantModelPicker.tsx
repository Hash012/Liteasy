import { useEffect, useRef, useState } from "react";
import { Button, Input, Popover, PopoverSurface, PopoverTrigger, Spinner, Tooltip } from "@fluentui/react-components";
import { CheckmarkRegular, ChevronDownRegular, SearchRegular } from "@fluentui/react-icons";
import type { createSettingsStore } from "../settings/settings.store";
import type { SettingsState } from "../settings/settings.types";
import { getModelForSettings } from "./modelPolicy";
import { directModelNeedsKey, getDirectModelConfig, getModelProvider, isDirectModelMode } from "./modelProviders";
import { hasDirectModelKey } from "./directModelTransport";
import { directModelSettingCommands, loadVerifiedModelProfiles, modelProfileId, type VerifiedModelProfile } from "./verifiedModelProfiles";
import { useVerifiedModels } from "./useVerifiedModels";
import "./assistantModelPicker.css";

export function AssistantModelPicker({ settingsStore, onSettingsChanged, disabled = false }: {
  settingsStore: ReturnType<typeof createSettingsStore>; onSettingsChanged?: (settings: SettingsState) => void; disabled?: boolean;
}) {
  const { profiles, loading, refresh } = useVerifiedModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [, changed] = useState(0);
  const locked = useRef(disabled); locked.current = disabled;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const settings = settingsStore.getState();
  const currentModel = getModelForSettings(settings);
  let activeId = "";
  try { if (isDirectModelMode(settings)) activeId = modelProfileId(getDirectModelConfig(settings)); } catch { /* Settings may still be incomplete. */ }
  const available = profiles.filter(({ config }) => [config.model, getModelProvider(config.provider).label, config.endpoint].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  async function select(profile: VerifiedModelProfile) {
    if (locked.current || switching) return;
    setSwitching(true); setError("");
    try {
      const hasKey = !directModelNeedsKey(profile.config) || await hasDirectModelKey(profile.config);
      if (!mounted.current || locked.current) return;
      if (!hasKey || !loadVerifiedModelProfiles().some((entry) => entry.id === profile.id)) {
        refresh(); throw new Error("此模型的连接已变更，请在设置 → AI 接入中重新保存并测试。");
      }
      for (const command of directModelSettingCommands(profile.config)) settingsStore.apply(command);
      onSettingsChanged?.({ ...settingsStore.getState() });
      changed((value) => value + 1); setOpen(false);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "模型切换失败。"); }
    finally { if (mounted.current) setSwitching(false); }
  }
  return <Popover open={open && !disabled} onOpenChange={(_, data) => {
    setOpen(data.open); if (data.open) { refresh(); setQuery(""); setError(""); }
  }} positioning="above-start" trapFocus>
    <PopoverTrigger disableButtonEnhancement>
      <Tooltip content={disabled ? "当前任务结束后可切换模型" : `切换模型 · ${currentModel}`} relationship="description">
        <Button appearance="subtle" size="small" className="assistant-model-trigger" disabled={disabled || switching}
          aria-label={`切换模型：${currentModel}`} icon={<ChevronDownRegular />} iconPosition="after">
          <span>{currentModel || "选择模型"}</span>
        </Button>
      </Tooltip>
    </PopoverTrigger>
    <PopoverSurface aria-label="选择对话模型" className="assistant-model-popover">
      <strong>选择模型</strong>
      <Input aria-label="搜索可用模型" placeholder="搜索模型或服务商" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
      {loading ? <Spinner size="tiny" label="正在读取已验证模型…" /> : <div className="assistant-model-options" role="group" aria-label="已验证模型">
        {available.map((profile) => <Button key={profile.id} appearance={activeId === profile.id ? "secondary" : "subtle"}
          disabled={switching || disabled} aria-pressed={activeId === profile.id} onClick={() => void select(profile)}
          icon={activeId === profile.id ? <CheckmarkRegular /> : undefined}>
          <span><strong>{profile.config.model}</strong><small>{getModelProvider(profile.config.provider).label} · {profile.config.endpoint}</small></span>
        </Button>)}
        {!available.length ? <p>{profiles.length ? "没有匹配的模型。" : "暂无已验证模型。请在设置 → AI 接入中为模型“保存并测试”；测试成功且密钥可用的模型会显示在这里。"}</p> : null}
      </div>}
      {switching ? <Spinner size="tiny" label="正在切换模型…" /> : null}
      {error ? <p role="alert">{error}</p> : null}
      <p className="assistant-model-hint">切换后用于下一次请求。仅列出测试成功且密钥可用的模型。</p>
    </PopoverSurface>
  </Popover>;
}
