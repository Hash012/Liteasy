import { useId, useState } from "react";
import { Button, Field, Select, Textarea } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { generationPromptLimit, generationPromptStyles, getGenerationPrompt, presetGenerationPrompt, type GenerationPromptTask } from "./generationPrompts";
import { useGenerationPromptSettings } from "./GenerationPromptContext";
import "./generationPrompts.css";

export function GenerationPromptEditor({ task, value, onChange, disabled, global = false }: {
  task: GenerationPromptTask; value?: string; onChange(value: string | undefined): void; disabled?: boolean; global?: boolean;
}) {
  const settings = useGenerationPromptSettings();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const prompt = value ?? getGenerationPrompt(task, global ? undefined : settings);
  const style = value === undefined ? "default" : generationPromptStyles.find((item) => presetGenerationPrompt(task, item.id) === value)?.id ?? "custom";
  return <div className="generation-prompt-editor">
    <div className="generation-prompt-toolbar">
      <Field label="生成风格" orientation="horizontal">
        <Select aria-label="生成风格" disabled={disabled} value={style} onChange={(_, data) => onChange(data.value === "custom" ? value : data.value === "default" ? undefined : presetGenerationPrompt(task, data.value))}>
          <option value="default">{global ? "内置默认" : "使用全局设置"}</option>
          {generationPromptStyles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          {style === "custom" ? <option value="custom">自定义</option> : null}
        </Select>
      </Field>
      <Button type="button" appearance="subtle" size="small" disabled={disabled} icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>自定义系统提示词</Button>
    </div>
    {expanded ? <Field label={global ? "默认系统提示词" : "本次系统提示词"} hint={global ? "保存后用于此类生成；留空使用内置默认。最多 4,000 字符。" : "仅用于本次生成；留空使用全局设置。最多 4,000 字符。"}>
      <Textarea id={id} aria-label="自定义系统提示词" value={prompt} disabled={disabled} maxLength={generationPromptLimit} rows={4} resize="vertical" onChange={(_, data) => onChange(data.value)} />
    </Field> : null}
  </div>;
}
