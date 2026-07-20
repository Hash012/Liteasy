import type { Citation } from "../retrieval/retrieval.types";
import type { ModelExecutionTrace } from "../models/modelExecution";
import type { AnswerAuditResult } from "./answerAuditor";
import type { UIDslDocument } from "../generative-ui/generativeUi.types";
import type { HumanConfirmationRequest } from "../agent-runtime/agentRuntime.types";
import type { AssistantMode } from "../agent-runtime/agentRuntime.types";
import type { AgentConfirmationRequest } from "../agent-api/agentApi.types";

export type { AssistantMode };

export type AssistantConfirmationRequest = HumanConfirmationRequest | AgentConfirmationRequest;

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  contextTokens?: AssistantContextToken[];
  confidence?: number;
  audit?: AnswerAuditResult;
  confirmation?: AssistantConfirmationRequest;
  executionTrace?: ModelExecutionTrace;
  uiDsl?: UIDslDocument;
};

export type AssistantContextToken = {
  detail?: string;
  id: string;
  kind: "paper" | "page" | "pdf_selection" | "skill";
  label: string;
  prompt: string;
};

export type AssistantComposerSuggestion = {
  detail?: string;
  id: string;
  insertText?: string;
  label: string;
  token?: AssistantContextToken;
  trigger: "/" | "@" | "$";
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
