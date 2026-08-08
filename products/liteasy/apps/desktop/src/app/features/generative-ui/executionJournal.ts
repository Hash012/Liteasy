import type { ActionInvocation } from "../skills/actionRegistry";

export type ExecutionJournalEntry =
  | {
      input?: string;
      mode?: string;
      traceId: string;
      type: "input";
    }
  | {
      planId: string;
      plannerSource?: "fallback" | "model" | "rule";
      traceId: string;
      type: "plan";
    }
  | {
      actionId: ActionInvocation["actionId"] | string;
      result: "allow" | "confirm" | "deny";
      traceId: string;
      type: "policy";
    }
  | {
      actionId: ActionInvocation["actionId"] | string;
      confirmationId: string;
      decision: "accepted" | "rejected";
      traceId: string;
      type: "confirmation";
    }
  | {
      traceId: string;
      type: "ui_dsl";
      uiDslId: string;
    }
  | {
      actionId?: ActionInvocation["actionId"] | string;
      message?: string;
      traceId: string;
      type: "action_result";
    };

export type ExecutionJournal = {
  getTrace: (traceId: string) => ExecutionJournalEntry[];
  record: (entry: ExecutionJournalEntry) => void;
};

export function createExecutionJournal(): ExecutionJournal {
  const entries: ExecutionJournalEntry[] = [];

  return {
    getTrace(traceId: string) {
      return entries.filter((entry) => entry.traceId === traceId).map((entry) => ({ ...entry }));
    },
    record(entry: ExecutionJournalEntry) {
      entries.push({ ...entry });
    }
  };
}

export const executionJournal = createExecutionJournal();
