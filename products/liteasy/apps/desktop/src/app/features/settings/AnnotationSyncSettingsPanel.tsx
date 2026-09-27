import { Field, Input } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";

export function AnnotationSyncSettingsPanel({ settings, onUpdateSetting }: {
  settings?: Partial<SettingsState>;
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
}) {
  return <Field label="Intuecho 同步端点" hint="仅支持 HTTPS；未配置时，公开批注保留在本地等待同步。">
    <Input aria-label="Intuecho 同步端点" type="url" placeholder="https://intuecho.example.com"
      value={settings?.["thin_reading.intuecho_endpoint"] ?? ""}
      onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "thin_reading.intuecho_endpoint", value: data.value.trim() })} />
  </Field>;
}
