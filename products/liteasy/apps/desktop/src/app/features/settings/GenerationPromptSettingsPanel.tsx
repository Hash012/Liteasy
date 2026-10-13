import { OptionPicker } from "../../shared/ui/productPrimitives";
import { useState } from "react";
import { Field } from "@fluentui/react-components";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { generationPromptKey, generationPromptTasks, type GenerationPromptTask } from "../ai-prompts/generationPrompts";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";

export function GenerationPromptSettingsPanel({ settings, onUpdateSetting }: {
  settings?: Partial<SettingsState>; onUpdateSetting?: (command: UpdateSettingCommand) => void;
}) {
  const [task, setTask] = useState<GenerationPromptTask>("selection_explanation");
  const saved = settings?.[generationPromptKey(task)];
  return <div className="generation-prompt-settings">
    <Field label="生成用途"><OptionPicker aria-label="提示词用途" value={task} onValueChange={(value) => setTask(value as GenerationPromptTask)}
      options={Object.entries(generationPromptTasks).map(([value, item]) => ({ value, label: item.label }))} /></Field>
    <GenerationPromptEditor key={task} task={task} global value={saved === generationPromptTasks[task].prompt ? undefined : saved}
      disabled={!onUpdateSetting} onChange={(value) => onUpdateSetting?.({ intent: "update_setting", target: generationPromptKey(task), value: value ?? generationPromptTasks[task].prompt })} />
  </div>;
}
