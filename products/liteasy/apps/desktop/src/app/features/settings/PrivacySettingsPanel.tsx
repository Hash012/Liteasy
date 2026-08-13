import { Switch } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";

type PrivacySettingsPanelProps = {
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
};

export function PrivacySettingsPanel({ onUpdateSetting, settings }: PrivacySettingsPanelProps) {
  const enabled = settings?.["privacy.cloud_pdf_parsing.enabled"] === true;
  return (
    <div aria-label="隐私设置" className="privacy-settings-panel">
      <Switch
        checked={enabled}
        label="允许云端结构解析 PDF"
        onChange={(_, data) => onUpdateSetting?.({
          intent: "update_setting",
          target: "privacy.cloud_pdf_parsing.enabled",
          value: data.checked
        })}
      />
      <span className="privacy-settings-description">
        开启后，Liteasy 会将当前 PDF 临时发送至云端提取引用结构。云端不保存原始 PDF，仅保存文件哈希、解析器版本和结构化 TEI 结果以供复用。
      </span>
    </div>
  );
}
