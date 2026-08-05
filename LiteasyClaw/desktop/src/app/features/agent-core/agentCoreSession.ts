import type { AgentRuntimeContextView, AgentRuntimeEvent } from "../agent-runtime/agentRuntime.types";
import {
  defaultAgentCoreConfig,
  type AgentCoreConfig,
  type AgentMemoryEntry
} from "./agentCoreConfig";
import { createAgentBudgetGuard, type AgentTurnFingerprint } from "./budgetGuard";
import {
  buildAgentCorePromptContext,
  formatAgentCorePromptContext,
  type AgentCorePromptContext
} from "./contextAssembler";
import { createAgentMemoryStore, type AgentMemoryStore } from "./memoryStore";

export type AgentCoreRuntimeContext = {
  budget: {
    maxIterations: number;
    maxToolCalls: number;
  };
  prompt: AgentCorePromptContext;
  promptText: string;
};

export type AgentCorePreparedTurn = {
  fingerprint: AgentTurnFingerprint;
  runtimeContext: AgentCoreRuntimeContext;
};

export type AgentCorePrepareResult =
  | {
      ok: true;
      turn: AgentCorePreparedTurn;
    }
  | {
      events: AgentRuntimeEvent[];
      ok: false;
    };

export type AgentCoreSession = {
  getMemoryStore: () => AgentMemoryStore;
  observeKnowledgeTurn: (input: {
    failed?: boolean;
    summary: string;
    turn: AgentCorePreparedTurn;
  }) => void;
  observeRuntimeTurn: (input: {
    events: AgentRuntimeEvent[];
    turn: AgentCorePreparedTurn;
  }) => void;
  prepareTurn: (input: {
    message: string;
    mode: string;
    runtimeContext?: AgentRuntimeContextView;
  }) => AgentCorePrepareResult;
};

export function createAgentCoreSession(
  config: AgentCoreConfig = defaultAgentCoreConfig,
  personalization: {
    getMemories?: () => AgentMemoryEntry[];
    getUserStateSummary?: () => string;
  } = {}
): AgentCoreSession {
  const memoryStore = createAgentMemoryStore(config.memories);
  const budgetGuard = createAgentBudgetGuard(config);

  return {
    getMemoryStore() {
      return memoryStore;
    },

    prepareTurn({ message, mode, runtimeContext }) {
      const budgetDecision = budgetGuard.prepareTurn({ message, mode });
      if (!budgetDecision.allowed) {
        /*
         * 预算拦截也要用“指令式错误信息”，不要只告诉用户/模型达到了限制。
         * 这里直接返回 runtime_error event，让现有 AssistantPane 可以像处理 runtime 错误一样展示。
         */
        return {
          events: [
            {
              message: budgetDecision.message,
              recovery: budgetDecision.recovery,
              type: "runtime_error"
            }
          ],
          ok: false
        };
      }

      const activeMemoryStore = personalization.getMemories
        ? createAgentMemoryStore(personalization.getMemories())
        : memoryStore;
      const memories = activeMemoryStore.search({
        limit: 4,
        query: message
      });
      const prompt = buildAgentCorePromptContext({
        config,
        memories,
        runtimeContext,
        userStateSummary: personalization.getUserStateSummary?.()
      });

      return {
        ok: true,
        turn: {
          fingerprint: budgetDecision.fingerprint,
          runtimeContext: {
            budget: {
              maxIterations: config.budget.maxIterations,
              maxToolCalls: config.budget.maxToolCalls
            },
            prompt,
            promptText: formatAgentCorePromptContext(prompt)
          }
        }
      };
    },

    observeRuntimeTurn({ events, turn }) {
      budgetGuard.observeTurn({
        events,
        fingerprint: turn.fingerprint
      });
    },

    observeKnowledgeTurn({ failed, summary, turn }) {
      budgetGuard.observeKnowledgeTurn({
        failed,
        fingerprint: turn.fingerprint,
        summary
      });
    }
  };
}
