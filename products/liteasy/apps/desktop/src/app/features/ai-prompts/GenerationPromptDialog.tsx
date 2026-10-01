import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { GenerationPromptEditor } from "./GenerationPromptEditor";
import { getGenerationPrompt, type GenerationPromptTask } from "./generationPrompts";
import { useGenerationPromptSettings } from "./GenerationPromptContext";

export function GenerationPromptDialog({ task, title, onClose, onConfirm }: {
  task: GenerationPromptTask; title: string; onClose(): void; onConfirm(prompt: string): void;
}) {
  const [prompt, setPrompt] = useState<string>();
  const settings = useGenerationPromptSettings();
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface><DialogBody>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><GenerationPromptEditor task={task} value={prompt} onChange={setPrompt} /></DialogContent>
      <DialogActions><Button onClick={onClose}>取消</Button><Button appearance="primary" onClick={() => onConfirm(getGenerationPrompt(task, settings, prompt))}>开始生成</Button></DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>;
}
