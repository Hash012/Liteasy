import type { Citation } from "../retrieval/retrieval.types";
import type { ModelExecutionTrace } from "../models/modelExecution";

export type AssistantMode = "explain" | "command" | "qa";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number;
  executionTrace?: ModelExecutionTrace;
};

export type AssistantState = {
  mode: AssistantMode;
  messages: AssistantMessage[];
  pending: boolean;
};

export type SelectedSetStatus = {
  selectedCount: number;
  importedCount: number;
  selectionLocked: boolean;
};
