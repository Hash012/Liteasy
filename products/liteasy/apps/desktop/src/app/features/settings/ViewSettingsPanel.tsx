import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { Button, Tooltip, Field, Input, Option, Radio, RadioGroup, Dropdown } from "@fluentui/react-components";
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
  const update = (target: UpdateSettingCommand["target"], value: string) =>
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

      <Field label={<span>界面字体 {workbench ? <Tooltip content="解释此设置" relationship="description"><Button size="small" appearance="subtle" onClick={() => workbench.explain({ type: "setting", key: "view.font_family" })}>解释</Button></Tooltip> : null}</span>}>
        <Dropdown
          aria-label="界面字体"
          onOptionSelect={(_, data) => data.optionValue && update("view.font_family", data.optionValue)}
          selectedOptions={[fontFamily]}
          size="small"
          value={viewFontOptions.find((option) => option.value === fontFamily)?.label ?? "自定义字体"}
        >
          {viewFontOptions.map((option) => (
            <Option key={option.value} value={option.value}>{option.label}</Option>
          ))}
        </Dropdown>
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
