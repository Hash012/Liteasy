import { Button, Field } from "@fluentui/react-components";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import { quickAskPresetOptions } from "./quickAskPresetPresentation";
import type { QuickAskPreset } from "./quickAskPresets";
import "./quickAskPresets.css";

export function QuickAskPresetPicker({ presets, selectedPresetId, onSelect, customInstruction = "", onUsePreset }: {
  presets: readonly QuickAskPreset[]; selectedPresetId: string; onSelect(id: string): void;
  customInstruction?: string; onUsePreset?(): void;
}) {
  const options = quickAskPresetOptions(presets);
  const pinned = presets.filter(item => item.pinned).slice(0, 4);
  const others = presets.filter(item => !pinned.some(entry => entry.id === item.id));
  return <div className="quick-ask-preset-picker">
    <div className="quick-ask-preset-actions" role="group" aria-label="速问任务">
      {pinned.map(item => <Button key={item.id} size="small" appearance={item.id === selectedPresetId ? "primary" : "subtle"}
        aria-pressed={item.id === selectedPresetId} onClick={() => onSelect(item.id)}>{options.find(option => option.value === item.id)?.label}</Button>)}
    </div>
    {!!others.length && <Field label="更多任务"><OptionPicker aria-label="更多速问任务" value={others.some(item => item.id === selectedPresetId) ? selectedPresetId : ""}
      onValueChange={(value) => { if (value) onSelect(value); }} placeholder="选择快捷指令"
      options={options.filter(option => others.some(item => item.id === option.value))} /></Field>}
    {customInstruction.trim() && <div className="quick-ask-preset-hint"><span>使用本次指令。已选择预设；清空本次指令后使用。</span>
      {onUsePreset && <Button size="small" appearance="subtle" onClick={onUsePreset}>使用预设</Button>}</div>}
  </div>;
}

export { QuickAskPresetManager } from "./QuickAskPresetManager";
