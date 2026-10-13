import { OptionPicker } from "../../shared/ui/productPrimitives";
import { useId, useState } from "react";
import { Button, Field, Textarea } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { generationPromptLimit, generationPromptStyles, getGenerationPrompt, presetGenerationPrompt, type GenerationPromptTask } from "./generationPrompts";
import { useGenerationPromptSettings } from "./GenerationPromptContext";
import "./generationPrompts.css";

export function GenerationPromptEditor({ task, value, onChange, disabled, global = false, context = global ? "settings" : "standard" }: {
  task: GenerationPromptTask; value?: string; onChange(value: string | undefined): void; disabled?: boolean; global?: boolean; context?: "quick" | "standard" | "settings";
}) {
  const settings = useGenerationPromptSettings();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const prompt = value ?? getGenerationPrompt(task, global ? undefined : settings);
  const style = value === undefined ? "default" : generationPromptStyles.find((item) => presetGenerationPrompt(task, item.id) === value)?.id ?? "custom";
  return <div className="generation-prompt-editor">
    <div className="generation-prompt-toolbar">
      <Field label={context === "quick" ? undefined : "生成风格"} orientation="horizontal">
        <OptionPicker aria-label="生成风格" disabled={disabled} value={style}
          onValueChange={(next) => onChange(next === "custom" ? value : next === "default" ? undefined : presetGenerationPrompt(task, next))}
          options={[{ value: "default", label: global ? "内置默认" : "使用全局设置" }, ...generationPromptStyles.map((item) => ({ value: item.id, label: item.label })), ...(style === "custom" ? [{ value: "custom", label: "自定义" }] : [])]} />
      </Field>
      <Button type="button" appearance="subtle" size="small" disabled={disabled} icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{context === "quick" ? style === "custom" ? "自定义已生效 · 编辑" : "更多指令" : "自定义系统提示词"}</Button>
    </div>
    {expanded ? <Field label={global ? "默认系统提示词" : "本次系统提示词"} hint={global ? "保存后用于此类生成；留空使用内置默认。最多 4,000 字符。" : "仅用于本次生成；留空使用全局设置。最多 4,000 字符。"}>
      <Textarea id={id} aria-label="自定义系统提示词" value={prompt} disabled={disabled} maxLength={generationPromptLimit} rows={4} resize="vertical" onChange={(_, data) => onChange(data.value)} />
    </Field> : null}
  </div>;
}
