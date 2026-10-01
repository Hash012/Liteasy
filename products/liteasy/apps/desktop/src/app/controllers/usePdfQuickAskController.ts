import { getGenerationPrompt } from "../features/ai-prompts/generationPrompts";
import type { SettingsState } from "../features/settings/settings.types";
import type { PdfQuickAskRequest } from "../features/pdf/pdfQuickAsk";
import type { ObjectRef } from "../features/objects/object.types";
import type { ContextRef } from "../features/context/objectContext";

export function usePdfQuickAskController(input: {
  capture(request: PdfQuickAskRequest): Promise<ObjectRef[]>;
  getSettings?(): SettingsState;
  ask(question: string, refs: ContextRef[], signal?: AbortSignal, updateWorkbench?: boolean, generation?: { task: "selection_explanation"; prompt: string }): Promise<string>;
}) {
  return async (request: PdfQuickAskRequest): Promise<string> => {
    if (request.signal.aborted) throw new Error("提问已取消。");
    const refs = await input.capture(request);
    if (request.signal.aborted) throw new Error("提问已取消。");
    return input.ask(request.question, refs, request.signal, true, { task: "selection_explanation", prompt: getGenerationPrompt("selection_explanation", input.getSettings?.(), request.systemPrompt) });
  };
}
