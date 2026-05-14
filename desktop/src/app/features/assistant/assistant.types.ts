import type { Citation } from "../retrieval/retrieval.types";
import type { ModelExecutionTrace } from "../models/modelExecution";
import type { AnswerAuditResult } from "./answerAuditor";

export type AssistantMode = "explain" | "command" | "qa";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number;
  audit?: AnswerAuditResult;
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
