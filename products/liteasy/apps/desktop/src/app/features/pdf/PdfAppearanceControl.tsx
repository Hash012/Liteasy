import { Button, Checkbox, Field, Input, Popover, PopoverSurface, PopoverTrigger, Tooltip } from "@fluentui/react-components";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import { ColorBackgroundRegular } from "@fluentui/react-icons";
import { isHexColor, pdfBackgroundPresets } from "../settings/viewSettings";
import type { SettingsState } from "../settings/settings.types";

export type PdfAppearance = { background: SettingsState["view.pdf_background"]; customBackground: string; preserveImages: boolean };
export function PdfAppearanceControl({ value, onChange }: { value: PdfAppearance; onChange: (value: PdfAppearance) => void }) {
  return <Popover positioning="below-end"><PopoverTrigger disableButtonEnhancement>
    <Tooltip content="PDF 阅读配色" relationship="description"><Button size="small" appearance="subtle" icon={<ColorBackgroundRegular />} aria-label="PDF 阅读配色" /></Tooltip>
  </PopoverTrigger><PopoverSurface aria-label="PDF 阅读配色设置" className="pdf-appearance-options">
    <Field label="页面配色"><OptionPicker aria-label="PDF 页面配色" value={value.background} onValueChange={(background) => onChange({ ...value, background: background as PdfAppearance["background"] })}
      options={pdfBackgroundPresets.map((preset) => ({ value: preset.value, label: preset.label }))} /></Field>
    {value.background === "custom" ? <Field label="自定义页面颜色"><div className="view-settings-custom-color">
      <Input aria-label="自定义 PDF 页面颜色" value={value.customBackground} onChange={(_, data) => onChange({ ...value, customBackground: data.value })} />
      <input aria-label="选择 PDF 页面颜色" type="color" value={isHexColor(value.customBackground) ? value.customBackground : "#ffffff"} onChange={(event) => onChange({ ...value, customBackground: event.target.value })} />
    </div></Field> : null}
    <Checkbox label="保留图片原色" checked={value.preserveImages} onChange={(_, data) => onChange({ ...value, preserveImages: data.checked === true })} />
    <small>配色自动保存，不修改原文件。扫描页本身是图片，可取消保留原色后调整。</small>
  </PopoverSurface></Popover>;
}
