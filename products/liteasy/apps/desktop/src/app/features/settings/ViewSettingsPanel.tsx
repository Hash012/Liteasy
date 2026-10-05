import { LanguageSettingsRow } from "./LanguageSettingsRow";
import { message } from "../../shared/i18n/i18n";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { SystemFontPicker } from "./SystemFontPicker";
import { chineseFontOptions, englishFontOptions, normalizeLanguageFont, resolveTypography } from "./typography";
import { Field, Input, Option, Radio, RadioGroup, Dropdown, Switch, Select } from "@fluentui/react-components";
import { SettingRow } from "../workbench/WorkbenchPage";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";
import { isHexColor, normalizeDisplayScale, pdfBackgroundPresets, viewDisplayScaleOptions, viewFontSizeOptions } from "./viewSettings";
import { normalizeAppearancePreference } from "../theme/appearancePreference";

type ViewSettingsPanelProps = { onUpdateSetting?: (command: UpdateSettingCommand) => void; settings?: Partial<SettingsState> };
export function ViewSettingsPanel({ onUpdateSetting, settings }: ViewSettingsPanelProps) {
  useUiTranslation();
  const typography = resolveTypography(settings);
  const fontSize = settings?.["view.font_size"] ?? "14";
  const displayScale = normalizeDisplayScale(settings?.["view.display_scale"]);
  const pdfBackground = settings?.["view.pdf_background"] ?? "paper";
  const customPdfBackground = settings?.["view.pdf_custom_background"] ?? "#ffffff";
  const update = (target: UpdateSettingCommand["target"], value: string | boolean) => onUpdateSetting?.({ intent: "update_setting", target, value });
  return <div aria-label={message("view.panel")} className="view-settings-panel">
    <h3 className="settings-group-title">{message("view.interface.heading")}</h3>
    <LanguageSettingsRow onUpdateSetting={onUpdateSetting} />
    <SettingRow title={message("view.theme.title")} description={message("view.theme.description")}>
      <Select aria-label={message("view.appearance")} value={normalizeAppearancePreference(settings?.["view.theme"])} onChange={(_, data) => update("view.theme", data.value)}>
        <option value="system">{message("view.system")}</option><option value="light">{message("view.light")}</option><option value="dark">{message("view.dark")}</option>
      </Select>
    </SettingRow>
    <SettingRow title={message("view.density")} description={message("view.density.description")}>
      <Select aria-label={message("view.density")} value={settings?.["view.list_density"] ?? "comfortable"} onChange={(_, data) => update("view.list_density", data.value)}>
        <option value="comfortable">{message("view.comfortable")}</option><option value="compact">{message("view.compact")}</option>
      </Select>
    </SettingRow>
    <SettingRow title={message("view.interfaceFontZh")}><SystemFontPicker label={message("view.interfaceFontZh")} value={normalizeLanguageFont(settings?.["view.font_family_zh"])} options={[{ get label() { return message("view.keepInterfaceFont"); }, value: "" }, ...chineseFontOptions]} onChange={(value) => update("view.font_family_zh", value)} /></SettingRow>
    <SettingRow title={message("view.interfaceFontEn")} description={message("view.interfaceFontEn.description")}><SystemFontPicker label={message("view.interfaceFontEn")} value={normalizeLanguageFont(settings?.["view.font_family_en"])} options={[{ get label() { return message("view.keepInterfaceFont"); }, value: "" }, ...englishFontOptions]} onChange={(value) => update("view.font_family_en", value)} /></SettingRow>
    <div className="settings-reading-preview" aria-label={message("view.interfaceFontPreview")} style={{ fontFamily: typography.interfaceFamily }}>文献库 · Library · 2026<small>{message("view.mixedPreview")}</small></div>
    <SettingRow title={message("view.fontSize")}>
      <Dropdown aria-label={message("view.fontSize")} selectedOptions={[fontSize]} value={viewFontSizeOptions.find((option) => option.value === fontSize)?.label ?? `${fontSize} px`}
        onOptionSelect={(_, data) => data.optionValue && update("view.font_size", data.optionValue)}>
        {viewFontSizeOptions.map((option) => <Option key={option.value} value={option.value}>{option.label}</Option>)}
      </Dropdown>
    </SettingRow>
    <SettingRow title={message("view.scale")} description={message("view.scale.description")}>
      <Dropdown aria-label={message("view.scale")} selectedOptions={[displayScale]} value={viewDisplayScaleOptions.find((option) => option.value === displayScale)?.label ?? `${displayScale}%`}
        onOptionSelect={(_, data) => data.optionValue && update("view.display_scale", data.optionValue)}>
        {viewDisplayScaleOptions.map((option) => <Option key={option.value} value={option.value}>{option.label}</Option>)}
      </Dropdown>
    </SettingRow>
    <SettingRow title={message("view.closeEmpty")} description={message("view.closeEmpty.description")}>
      <Switch aria-label={message("view.closeEmpty")} checked={settings?.["view.close_empty_panels"] !== false} onChange={(_, data) => update("view.close_empty_panels", data.checked)} />
    </SettingRow>
    <h3 className="settings-group-title">{message("view.reading.heading")}</h3>
    <SettingRow title={message("view.readerFontZh")} description={message("view.readerFont.description")}>
      <SystemFontPicker label={message("view.readerFontZh")} value={normalizeLanguageFont(settings?.["view.reader_font_family_zh"])} options={[{ get label() { return message("view.keepReaderFont"); }, value: "" }, { get label() { return message("view.inheritZh"); }, value: "inherit" }, ...chineseFontOptions]} onChange={(value) => update("view.reader_font_family_zh", value)} />
    </SettingRow>
    <SettingRow title={message("view.readerFontEn")}>
      <SystemFontPicker label={message("view.readerFontEn")} value={normalizeLanguageFont(settings?.["view.reader_font_family_en"])} options={[{ get label() { return message("view.keepReaderFont"); }, value: "" }, { get label() { return message("view.inheritEn"); }, value: "inherit" }, ...englishFontOptions]} onChange={(value) => update("view.reader_font_family_en", value)} />
    </SettingRow>
    <div className="settings-reading-preview" aria-label={message("view.readerPreview")} style={{ fontFamily: typography.readerFamily }}>
      阅读应该连续，而不是被控件打断。<br />Reading begins with a question.<small>{message("view.readerPreview.caption")}</small>
    </div>
    <SettingRow title={message("view.markdownMode")} description={message("view.markdownMode.description")}>
      <RadioGroup aria-label={message("view.markdownMode")} value={settings?.["view.markdown_mode"] ?? "live"} onChange={(_, data) => update("view.markdown_mode", data.value)}>
        <Radio value="live" label={message("view.liveMode")} /><Radio value="manual" label={message("view.manualMode")} />
      </RadioGroup>
    </SettingRow>
    <SettingRow title={message("view.autosave")} description={message("view.autosave.description")}>
      <Switch aria-label={message("view.autosave")} checked={settings?.["view.markdown_autosave"] !== false} disabled={settings?.["view.markdown_mode"] === "manual"} onChange={(_, data) => update("view.markdown_autosave", data.checked)} />
    </SettingRow>
    <h3 className="settings-group-title">{message("view.pdf.heading")}</h3>
    <SettingRow title={message("view.pdf.background")} description={message("view.pdf.description")}>
      <RadioGroup aria-label={message("view.pdf.background")} className="view-settings-backgrounds" value={pdfBackground} onChange={(_, data) => update("view.pdf_background", data.value)}>
        {pdfBackgroundPresets.map((preset) => <Radio key={preset.value} value={preset.value} label={<span className="view-settings-color-label"><span aria-hidden className="view-settings-color-swatch" style={{ backgroundColor: preset.color }} />{preset.label}</span>} />)}
      </RadioGroup>
    </SettingRow>
    <SettingRow title={message("view.pdf.preserveImages")}><Switch aria-label={message("view.pdf.preserveImages")} checked={settings?.["view.pdf_preserve_images"] !== false} onChange={(_, data) => update("view.pdf_preserve_images", data.checked)} /></SettingRow>
    {pdfBackground === "custom" ? <Field label={message("view.pdf.customColor")} hint={message("view.pdf.colorHint")}><div className="view-settings-custom-color">
      <Input aria-label={message("view.pdf.customBackground")} value={customPdfBackground} onChange={(_, data) => update("view.pdf_custom_background", data.value)} />
      <input aria-label={message("view.pdf.pickCustom")} className="view-settings-native-color" type="color" value={isHexColor(customPdfBackground) ? customPdfBackground : "#ffffff"} onChange={(event) => update("view.pdf_custom_background", event.target.value)} />
    </div></Field> : null}
    <p className="settings-save-contract">{message("view.saveContract")}</p>
  </div>;
}
