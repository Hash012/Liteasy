export type AssistantMode = "explain" | "command" | "qa";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AssistantState = {
  mode: AssistantMode;
  messages: AssistantMessage[];
  pending: boolean;
};
