import { useState } from "react";
import { Select } from "@fluentui/react-components";
import { SettingRow } from "../workbench/WorkbenchPage";
import type { UpdateSettingCommand } from "./settings.types";
import { useUiLanguagePreference } from "./uiLanguagePreference";
import { isUiLanguagePreference } from "../../shared/i18n/localePolicy";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";

export function LanguageSettingsRow({ onUpdateSetting }: {
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
}) {
  const { t } = useUiTranslation();
  const snapshot = useUiLanguagePreference();
  const [failed, setFailed] = useState(false);
  return <SettingRow title={t("ui.language.label")} description={t("ui.language.description")}>
    <div className="ui-language-setting">
      <Select aria-label={t("ui.language.label")} value={snapshot.preference} disabled={!onUpdateSetting}
        onChange={(_, data) => {
          if (!isUiLanguagePreference(data.value)) return;
          setFailed(false);
          try { onUpdateSetting?.({ intent: "update_setting", target: "view.language", value: data.value }); }
          catch { setFailed(true); }
        }}>
        <option value="system">{t("ui.language.system")}</option>
        <option value="zh-CN" lang="zh-CN">简体中文</option>
        <option value="en-US" lang="en-US">English (United States)</option>
      </Select>
      <small role="status" aria-live="polite">{t("ui.language.active", {
        language: snapshot.locale === "zh-CN" ? "简体中文" : "English (United States)"
      })}</small>
      {snapshot.persistence === "session" ? <small role="status">{t("ui.language.sessionOnly")}</small> : null}
      {failed ? <small role="alert">{t("ui.language.failed")}</small> : null}
    </div>
  </SettingRow>;
}
