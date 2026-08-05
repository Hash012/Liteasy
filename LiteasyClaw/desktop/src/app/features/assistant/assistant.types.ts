import type { Citation } from "../retrieval/retrieval.types";
import type { ModelExecutionTrace } from "../models/modelExecution";
import type { AnswerAuditResult } from "./answerAuditor";
import type { UIDslDocument } from "../generative-ui/generativeUi.types";
import type { HumanConfirmationRequest } from "../agent-runtime/agentRuntime.types";
import type { AssistantMode } from "../agent-runtime/agentRuntime.types";
import type {
  AgentConfirmationRequest,
  PublicWorkflowAuditSummary
} from "../agent-api/agentApi.types";

export type { AssistantMode };

export type AssistantConfirmationRequest = HumanConfirmationRequest | AgentConfirmationRequest;

export type AssistantMessage = {
  agentActivity?: AgentActivity;
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  contextTokens?: AssistantContextToken[];
  confidence?: number;
  audit?: AnswerAuditResult;
  confirmation?: AssistantConfirmationRequest;
  executionTrace?: ModelExecutionTrace;
  publicWorkflowAudits?: PublicWorkflowAuditSummary[];
  uiDsl?: UIDslDocument;
};

export type AgentActivityStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "waiting"
  | "working";

export type AgentActivityEntry = {
  content?: string;
  id: string;
  kind: "analysis" | "output" | "tool";
  label: string;
  status: "completed" | "failed" | "running" | "waiting";
};

/**
 * A user-facing projection of an Agent run. It intentionally excludes opaque
 * ids, raw tool arguments, and backend configuration so the worklog is useful
 * without exposing implementation details or credentials.
 */
export type AgentActivity = {
  entries: AgentActivityEntry[];
  generatedContent: string;
  progress?: number;
  status: AgentActivityStatus;
  statusText: string;
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
