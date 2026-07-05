import type { Citation } from "../retrieval/retrieval.types";
import type { ModelExecutionTrace } from "../models/modelExecution";
import type { AnswerAuditResult } from "./answerAuditor";
import type { UIDslDocument } from "../generative-ui/generativeUi.types";
import type { HumanConfirmationRequest } from "../agent-runtime/agentRuntime.types";
import type { AssistantMode } from "../agent-runtime/agentRuntime.types";

export type { AssistantMode };

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number;
  audit?: AnswerAuditResult;
  confirmation?: HumanConfirmationRequest;
  executionTrace?: ModelExecutionTrace;
  uiDsl?: UIDslDocument;
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
