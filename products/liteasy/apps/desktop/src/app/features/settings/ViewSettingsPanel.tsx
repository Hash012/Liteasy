import { Field, Input, Option, Radio, RadioGroup, Dropdown } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";
import { isHexColor, pdfBackgroundPresets, viewFontOptions, viewFontSizeOptions } from "./viewSettings";

type ViewSettingsPanelProps = {
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
};

const defaultFont = viewFontOptions[0].value;
const defaultFontSize = "14";
const defaultPdfBackground = "paper";
const defaultCustomPdfBackground = "#ffffff";

export function ViewSettingsPanel({ onUpdateSetting, settings }: ViewSettingsPanelProps) {
  const fontFamily = settings?.["view.font_family"] ?? defaultFont;
  const fontSize = settings?.["view.font_size"] ?? defaultFontSize;
  const pdfBackground = settings?.["view.pdf_background"] ?? defaultPdfBackground;
  const customPdfBackground = settings?.["view.pdf_custom_background"] ?? defaultCustomPdfBackground;
  const colorPickerValue = isHexColor(customPdfBackground)
    ? customPdfBackground
    : defaultCustomPdfBackground;
  const update = (target: UpdateSettingCommand["target"], value: string) =>
    onUpdateSetting?.({ intent: "update_setting", target, value });

  return (
    <div aria-label="View 显示设置" className="view-settings-panel">
      <Field label="界面字体">
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

      <Field label="界面字号">
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

      <Field label="PDF 阅读底色">
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
