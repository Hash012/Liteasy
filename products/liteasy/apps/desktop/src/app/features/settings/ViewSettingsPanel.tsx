import { SystemFontPicker } from "./SystemFontPicker";
import { normalizeReadingFontFamily, readingFontOptions } from "./readingFonts";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { Button, Tooltip, Field, Input, Option, Radio, RadioGroup, Dropdown, Switch } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";
import { isHexColor, normalizeDisplayScale, pdfBackgroundPresets, viewDisplayScaleOptions, viewFontOptions, viewFontSizeOptions } from "./viewSettings";
import { normalizeAppearancePreference } from "../theme/appearancePreference";
import { DarkThemeRegular, WeatherSunnyRegular, DesktopRegular } from "@fluentui/react-icons";

type ViewSettingsPanelProps = {
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
};

const defaultFont = viewFontOptions[0].value;
const defaultFontSize = "14";
const defaultPdfBackground = "paper";
const defaultCustomPdfBackground = "#ffffff";

export function ViewSettingsPanel({ onUpdateSetting, settings }: ViewSettingsPanelProps) {
  const workbench = useObjectWorkbench();
  const fontFamily = settings?.["view.font_family"] ?? defaultFont;
  const fontSize = settings?.["view.font_size"] ?? defaultFontSize;
  const displayScale = normalizeDisplayScale(settings?.["view.display_scale"]);
  const pdfBackground = settings?.["view.pdf_background"] ?? defaultPdfBackground;
  const customPdfBackground = settings?.["view.pdf_custom_background"] ?? defaultCustomPdfBackground;
  const colorPickerValue = isHexColor(customPdfBackground)
    ? customPdfBackground
    : defaultCustomPdfBackground;
  const update = (target: UpdateSettingCommand["target"], value: string | boolean) =>
    onUpdateSetting?.({ intent: "update_setting", target, value });

  return (
    <div aria-label="View 显示设置" className="view-settings-panel">
      <Field label="外观" hint="跟随系统自动切换，或选定你喜欢的外观。">
        <RadioGroup
          aria-label="外观"
          className="appearance-options"
          value={normalizeAppearancePreference(settings?.["view.theme"])}
          onChange={(_, data) => update("view.theme", data.value)}
        >
          <Radio value="system" label={<span><DesktopRegular aria-hidden="true" />跟随系统</span>} />
          <Radio value="light" label={<span><WeatherSunnyRegular aria-hidden="true" />浅色</span>} />
          <Radio value="dark" label={<span><DarkThemeRegular aria-hidden="true" />深色</span>} />
        </RadioGroup>
      </Field>

      <Field hint="关闭或移走最后一个页面后收起面板；全部页面关闭时保留起始页。">
        <Switch label="自动收起空面板" checked={settings?.["view.close_empty_panels"] !== false}
          onChange={(_, data) => update("view.close_empty_panels", data.checked)} />
      </Field>

      <Field label={<span>界面字体 {workbench ? <Tooltip content="解释此设置" relationship="description"><Button size="small" appearance="subtle" onClick={() => workbench.explain({ type: "setting", key: "view.font_family" })}>解释</Button></Tooltip> : null}</span>}>
        <SystemFontPicker label="界面字体" value={fontFamily} options={viewFontOptions} onChange={(value) => update("view.font_family", value)} />
      </Field>

      <Field label="Markdown 编辑方式" hint="即时预览中，点击正文直接编辑，其他段落保持阅读排版。">
        <RadioGroup aria-label="Markdown 编辑方式" value={settings?.["view.markdown_mode"] ?? "live"} onChange={(_, data) => update("view.markdown_mode", data.value)}>
          <Radio value="live" label="即时预览 · 边读边写" />
          <Radio value="manual" label="手动切换 · 编辑、保存、阅读" />
        </RadioGroup>
      </Field>
      <Field hint="停止输入约 1.5 秒后保存已有文件。发现版本冲突时暂停；新建笔记仍需首次保存。">
        <Switch label="Markdown 自动保存" checked={settings?.["view.markdown_autosave"] !== false} disabled={settings?.["view.markdown_mode"] === "manual"}
          onChange={(_, data) => update("view.markdown_autosave", data.checked)} />
      </Field>

      <Field label="非 PDF 阅读字体" hint="用于论文阅读模式、电子书和 Markdown/TXT。文档内可单独设置字体，选择“跟随阅读设置”可恢复统一字体。">
        <SystemFontPicker label="非 PDF 阅读字体" value={normalizeReadingFontFamily(settings?.["view.reader_font_family"])}
          options={readingFontOptions} onChange={(value) => update("view.reader_font_family", value)} />
      </Field>

      <Field label={<span>界面字号 {workbench ? <Tooltip content="解释此设置" relationship="description"><Button size="small" appearance="subtle" onClick={() => workbench.explain({ type: "setting", key: "view.font_size" })}>解释</Button></Tooltip> : null}</span>}>
        <Dropdown
          aria-label="界面字号"
          onOptionSelect={(_, data) => data.optionValue && update("view.font_size", data.optionValue)}
          selectedOptions={[fontSize]}
          size="small"
          value={viewFontSizeOptions.find((option) => option.value === fontSize)?.label ?? `${fontSize} px`}
        >
          {viewFontSizeOptions.map((option) => (
            <Option key={option.value} value={option.value}>{option.label}</Option>
          ))}
        </Dropdown>
      </Field>

      <Field
        label={<span>显示比例 {workbench ? <Tooltip content="解释此设置" relationship="description"><Button size="small" appearance="subtle" onClick={() => workbench.explain({ type: "setting", key: "view.display_scale" })}>解释</Button></Tooltip> : null}</span>}
        hint="Ctrl + 加号 / 减号缩放，Ctrl + 0 恢复默认"
      >
        <Dropdown
          aria-label="显示比例"
          onOptionSelect={(_, data) => data.optionValue && update("view.display_scale", data.optionValue)}
          selectedOptions={[displayScale]}
          size="small"
          value={viewDisplayScaleOptions.find((option) => option.value === displayScale)?.label ?? `${displayScale}%`}
        >
          {viewDisplayScaleOptions.map((option) => (
            <Option key={option.value} value={option.value}>{option.label}</Option>
          ))}
        </Dropdown>
      </Field>

      <Field label={<span>PDF 阅读底色 {workbench ? <Tooltip content="解释此设置" relationship="description"><Button size="small" appearance="subtle" onClick={() => workbench.explain({ type: "setting", key: "view.pdf_background" })}>解释</Button></Tooltip> : null}</span>}>
        <RadioGroup
          aria-label="PDF 阅读底色"
          className="view-settings-backgrounds"
          onChange={(_, data) => update("view.pdf_background", data.value)}
          value={pdfBackground}
        >
          {pdfBackgroundPresets.map((preset) => (
            <Radio
              key={preset.value}
              label={
                <span className="view-settings-color-label">
                  <span aria-hidden="true" className="view-settings-color-swatch" style={{ backgroundColor: preset.color }} />
                  {preset.label}
                </span>
              }
              value={preset.value}
            />
          ))}
        </RadioGroup>
      </Field>

      <Switch label="PDF 保留图片原色" checked={settings?.["view.pdf_preserve_images"] !== false}
        onChange={(_, data) => update("view.pdf_preserve_images", data.checked)} />
      {pdfBackground === "custom" ? (
        <Field label="自定义颜色" hint="输入十六进制颜色或使用系统拾色器">
          <div className="view-settings-custom-color">
            <Input
              aria-label="自定义 PDF 底色"
              onChange={(_, data) => update("view.pdf_custom_background", data.value)}
              size="small"
              value={customPdfBackground}
            />
            <input
              aria-label="选择自定义 PDF 底色"
              className="view-settings-native-color"
              onChange={(event) => update("view.pdf_custom_background", event.target.value)}
              type="color"
              value={colorPickerValue}
            />
          </div>
        </Field>
      ) : null}
    </div>
  );
}
