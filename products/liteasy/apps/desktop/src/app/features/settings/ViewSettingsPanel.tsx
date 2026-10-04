import { SystemFontPicker } from "./SystemFontPicker";
import { chineseFontOptions, englishFontOptions, normalizeLanguageFont, resolveTypography } from "./typography";
import { Field, Input, Option, Radio, RadioGroup, Dropdown, Switch, Select } from "@fluentui/react-components";
import { SettingRow } from "../workbench/WorkbenchPage";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";
import { isHexColor, normalizeDisplayScale, pdfBackgroundPresets, viewDisplayScaleOptions, viewFontSizeOptions } from "./viewSettings";
import { normalizeAppearancePreference } from "../theme/appearancePreference";

type ViewSettingsPanelProps = { onUpdateSetting?: (command: UpdateSettingCommand) => void; settings?: Partial<SettingsState> };
export function ViewSettingsPanel({ onUpdateSetting, settings }: ViewSettingsPanelProps) {
  const typography = resolveTypography(settings);
  const fontSize = settings?.["view.font_size"] ?? "14";
  const displayScale = normalizeDisplayScale(settings?.["view.display_scale"]);
  const pdfBackground = settings?.["view.pdf_background"] ?? "paper";
  const customPdfBackground = settings?.["view.pdf_custom_background"] ?? "#ffffff";
  const update = (target: UpdateSettingCommand["target"], value: string | boolean) => onUpdateSetting?.({ intent: "update_setting", target, value });
  return <div aria-label="View 显示设置" className="view-settings-panel">
    <h3 className="settings-group-title">应用界面</h3>
    <SettingRow title="界面主题" description="跟随系统自动切换；原始 PDF 的颜色独立设置。">
      <Select aria-label="外观" value={normalizeAppearancePreference(settings?.["view.theme"])} onChange={(_, data) => update("view.theme", data.value)}>
        <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
      </Select>
    </SettingRow>
    <SettingRow title="列表密度" description="调整文献列表的行距与辅助信息，不改变正文字号。">
      <Select aria-label="列表密度" value={settings?.["view.list_density"] ?? "comfortable"} onChange={(_, data) => update("view.list_density", data.value)}>
        <option value="comfortable">舒适</option><option value="compact">紧凑</option>
      </Select>
    </SettingRow>
    <SettingRow title="界面中文字体"><SystemFontPicker label="界面中文字体" value={normalizeLanguageFont(settings?.["view.font_family_zh"])} options={[{ label: "沿用原界面字体", value: "" }, ...chineseFontOptions]} onChange={(value) => update("view.font_family_zh", value)} /></SettingRow>
    <SettingRow title="界面英文字体" description="用于英文、数字与半角标点；中文字体独立选择。"><SystemFontPicker label="界面英文字体" value={normalizeLanguageFont(settings?.["view.font_family_en"])} options={[{ label: "沿用原界面字体", value: "" }, ...englishFontOptions]} onChange={(value) => update("view.font_family_en", value)} /></SettingRow>
    <div className="settings-reading-preview" aria-label="界面字体预览" style={{ fontFamily: typography.interfaceFamily }}>文献库 · Library · 2026<small>中英混排预览</small></div>
    <SettingRow title="界面字号">
      <Dropdown aria-label="界面字号" selectedOptions={[fontSize]} value={viewFontSizeOptions.find((option) => option.value === fontSize)?.label ?? `${fontSize} px`}
        onOptionSelect={(_, data) => data.optionValue && update("view.font_size", data.optionValue)}>
        {viewFontSizeOptions.map((option) => <Option key={option.value} value={option.value}>{option.label}</Option>)}
      </Dropdown>
    </SettingRow>
    <SettingRow title="显示比例" description="Ctrl + 加号 / 减号缩放，Ctrl + 0 恢复默认。">
      <Dropdown aria-label="显示比例" selectedOptions={[displayScale]} value={viewDisplayScaleOptions.find((option) => option.value === displayScale)?.label ?? `${displayScale}%`}
        onOptionSelect={(_, data) => data.optionValue && update("view.display_scale", data.optionValue)}>
        {viewDisplayScaleOptions.map((option) => <Option key={option.value} value={option.value}>{option.label}</Option>)}
      </Dropdown>
    </SettingRow>
    <SettingRow title="自动收起空面板" description="关闭最后一个页面后收起面板，保留起始页。">
      <Switch aria-label="自动收起空面板" checked={settings?.["view.close_empty_panels"] !== false} onChange={(_, data) => update("view.close_empty_panels", data.checked)} />
    </SettingRow>
    <h3 className="settings-group-title">文档阅读</h3>
    <SettingRow title="阅读中文字体" description="用于论文重排阅读、电子书、Markdown 与 TXT；文档内的单独字体设置优先，原始 PDF 保留其排版。">
      <SystemFontPicker label="阅读中文字体" value={normalizeLanguageFont(settings?.["view.reader_font_family_zh"])} options={[{ label: "沿用原阅读字体", value: "" }, { label: "跟随界面中文字体", value: "inherit" }, ...chineseFontOptions]} onChange={(value) => update("view.reader_font_family_zh", value)} />
    </SettingRow>
    <SettingRow title="阅读英文字体">
      <SystemFontPicker label="阅读英文字体" value={normalizeLanguageFont(settings?.["view.reader_font_family_en"])} options={[{ label: "沿用原阅读字体", value: "" }, { label: "跟随界面英文字体", value: "inherit" }, ...englishFontOptions]} onChange={(value) => update("view.reader_font_family_en", value)} />
    </SettingRow>
    <div className="settings-reading-preview" aria-label="阅读字体预览" style={{ fontFamily: typography.readerFamily }}>
      阅读应该连续，而不是被控件打断。<br />Reading begins with a question.<small>阅读字体预览 · 18 px / 1.7</small>
    </div>
    <SettingRow title="Markdown 编辑方式" description="即时预览中，点击正文编辑，其他段落保持阅读排版。">
      <RadioGroup aria-label="Markdown 编辑方式" value={settings?.["view.markdown_mode"] ?? "live"} onChange={(_, data) => update("view.markdown_mode", data.value)}>
        <Radio value="live" label="即时预览 · 边读边写" /><Radio value="manual" label="手动切换 · 编辑、保存、阅读" />
      </RadioGroup>
    </SettingRow>
    <SettingRow title="Markdown 自动保存" description="停止输入约 1.5 秒后保存；发现版本冲突时暂停。新笔记需要首次保存。">
      <Switch aria-label="Markdown 自动保存" checked={settings?.["view.markdown_autosave"] !== false} disabled={settings?.["view.markdown_mode"] === "manual"} onChange={(_, data) => update("view.markdown_autosave", data.checked)} />
    </SettingRow>
    <h3 className="settings-group-title">PDF 原文</h3>
    <SettingRow title="PDF 阅读底色" description="仅影响显示，不修改原文件。">
      <RadioGroup aria-label="PDF 阅读底色" className="view-settings-backgrounds" value={pdfBackground} onChange={(_, data) => update("view.pdf_background", data.value)}>
        {pdfBackgroundPresets.map((preset) => <Radio key={preset.value} value={preset.value} label={<span className="view-settings-color-label"><span aria-hidden className="view-settings-color-swatch" style={{ backgroundColor: preset.color }} />{preset.label}</span>} />)}
      </RadioGroup>
    </SettingRow>
    <SettingRow title="PDF 保留图片原色"><Switch aria-label="PDF 保留图片原色" checked={settings?.["view.pdf_preserve_images"] !== false} onChange={(_, data) => update("view.pdf_preserve_images", data.checked)} /></SettingRow>
    {pdfBackground === "custom" ? <Field label="自定义颜色" hint="输入十六进制颜色或使用系统拾色器"><div className="view-settings-custom-color">
      <Input aria-label="自定义 PDF 底色" value={customPdfBackground} onChange={(_, data) => update("view.pdf_custom_background", data.value)} />
      <input aria-label="选择自定义 PDF 底色" className="view-settings-native-color" type="color" value={isHexColor(customPdfBackground) ? customPdfBackground : "#ffffff"} onChange={(event) => update("view.pdf_custom_background", event.target.value)} />
    </div></Field> : null}
    <p className="settings-save-contract">外观更改即时生效；表单中需要确认的更改使用各自的保存按钮。</p>
  </div>;
}
