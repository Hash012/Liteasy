import { Switch } from "@fluentui/react-components";
import { RecommendationStyleControl } from "../recommendations/RecommendationStyleControl";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";

export function RecommendationSettingsPanel({ onUpdateSetting, settings }: {
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
}) {
  return (
    <div className="recommendation-settings-panel">
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
