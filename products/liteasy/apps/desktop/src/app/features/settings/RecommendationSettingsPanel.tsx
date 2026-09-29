import { useState } from "react";
import { clearLocalResearchProfile, exportLocalResearchProfile, loadLocalResearchProfile, localProfileTags } from "../profile/localResearchProfile";
import { Button, Switch } from "@fluentui/react-components";
import { RecommendationStyleControl } from "../recommendations/RecommendationStyleControl";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";

export function RecommendationSettingsPanel({ onUpdateSetting, settings }: {
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
}) {
  const [, setRevision] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const local = loadLocalResearchProfile();
  return (
    <div className="recommendation-settings-panel">
      <Switch label="本地文献模式（无需 Liteasy 登录）" checked={settings?.["papers.local_mode"] ?? false}
        onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "papers.local_mode", value: data.checked })} />
      {settings?.["papers.local_mode"] ? <div>
        <p>使用“文献服务”中配置的 API，联网更新、断网读取本机缓存。画像保存在本机；个性化回答和自动整理会向当前模型发送必要的偏好，可在个人中心管理。</p>
        <Switch label="使用本机画像个性化" checked={settings["profile.local_enabled"] ?? false}
          onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "profile.local_enabled", value: data.checked })} />
        <p>已记录 {local.events.length} 条行为（最多保留 500 条，同一天重复阅读合并）。</p>
        <p>{localProfileTags(local).slice(0, 12).map((tag) => `${tag.label}（${tag.evidenceCount}）`).join(" · ") || "开启记录后，阅读或收藏论文即可积累研究兴趣。"}</p>
        <Button onClick={() => setRevision((value) => value + 1)}>刷新画像</Button>
        <Button onClick={exportLocalResearchProfile}>导出测试数据</Button>
        <Button onClick={() => setConfirmClear(true)}>清空阅读记录</Button>
        {confirmClear ? <div role="group" aria-label="清空本机画像确认"><p>删除本机积累的行为记录和兴趣标签？</p><Button onClick={() => { clearLocalResearchProfile(); setConfirmClear(false); setRevision((value) => value + 1); }}>确认清空</Button><Button onClick={() => setConfirmClear(false)}>取消</Button></div> : null}
      </div> : null}
      <Switch
        checked={settings?.["network.recommendation.enabled"] ?? true}
        disabled={!onUpdateSetting}
        label="联网推荐"
        onChange={(_event, data) => onUpdateSetting?.({
          intent: "update_setting",
          target: "network.recommendation.enabled",
          value: data.checked
        })}
      />
      <RecommendationStyleControl
        onChange={onUpdateSetting ? (value) => onUpdateSetting({
          intent: "update_setting",
          target: "network.recommendation.style",
          value
        }) : undefined}
        value={settings?.["network.recommendation.style"] ?? "balanced"}
      />
    </div>
  );
}
