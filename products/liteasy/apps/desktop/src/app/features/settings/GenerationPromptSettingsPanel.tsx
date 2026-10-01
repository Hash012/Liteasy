import { useState } from "react";
import { Field, Select } from "@fluentui/react-components";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { generationPromptKey, generationPromptTasks, type GenerationPromptTask } from "../ai-prompts/generationPrompts";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";

export function GenerationPromptSettingsPanel({ settings, onUpdateSetting }: {
  settings?: Partial<SettingsState>; onUpdateSetting?: (command: UpdateSettingCommand) => void;
}) {
  const [task, setTask] = useState<GenerationPromptTask>("selection_explanation");
  const saved = settings?.[generationPromptKey(task)];
  return <div className="generation-prompt-settings">
    <Field label="生成用途"><Select aria-label="提示词用途" value={task} onChange={(_, data) => setTask(data.value as GenerationPromptTask)}>
      {Object.entries(generationPromptTasks).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
    </Select></Field>
    <GenerationPromptEditor key={task} task={task} global value={saved === generationPromptTasks[task].prompt ? undefined : saved}
      disabled={!onUpdateSetting} onChange={(value) => onUpdateSetting?.({ intent: "update_setting", target: generationPromptKey(task), value: value ?? generationPromptTasks[task].prompt })} />
  </div>;
}
