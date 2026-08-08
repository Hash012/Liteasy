import type { AgentRuntimeEvent } from "../agent-runtime/agentRuntime.types";
import type { AgentCoreConfig } from "./agentCoreConfig";

export type AgentTurnFingerprint = string;

export type AgentBudgetDecision =
  | {
      allowed: true;
      fingerprint: AgentTurnFingerprint;
    }
  | {
      allowed: false;
      message: string;
      recovery: string;
    };

export type AgentObservation = {
  isError: boolean;
  summary: string;
  turnIndex: number;
  type: AgentRuntimeEvent["type"] | "knowledge_answer";
};

export type AgentBudgetSnapshot = {
  failedFingerprints: Record<string, number>;
  observations: AgentObservation[];
  toolCalls: number;
  turns: number;
};

function normalizeMessage(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

function getEventSummary(event: AgentRuntimeEvent) {
  if (event.type === "action_failed" || event.type === "runtime_error") {
    return event.recovery ? `${event.message} ${event.recovery}` : event.message;
  }

  if (event.type === "assistant_reply") {
    return event.message;
  }

  if (event.type === "plan_preview") {
    return event.plan.summary;
  }

  if (event.type === "confirmation_request") {
    return event.summary;
  }

  if (event.type === "action_request") {
    return `action:${event.action.actionId}`;
  }

  if (event.type === "ui_dsl_ready") {
    return `ui:${event.document.id}`;
  }

  if (event.type === "clarification_request") {
    return event.question;
  }

  return event.type;
}

function isFailureEvent(event: AgentRuntimeEvent) {
  return event.type === "action_failed" || event.type === "runtime_error";
}

function compressObservations(observations: AgentObservation[], staleObservationTurns: number) {
  if (observations.length <= staleObservationTurns) {
    return observations;
  }

  const hotStart = Math.max(0, observations.length - staleObservationTurns);

  return observations.map((observation, index) => {
    if (index >= hotStart) {
      return observation;
    }

    /*
     * 观察压缩只保留“错误/状态/类型”这些高信号信息。
     * 这对应开发指南里的 observation compression：旧工具输出不该完整留在上下文，
     * 否则长会话会把模型工作台塞满，真正有用的是错误原因和状态变化。
     */
    return {
      ...observation,
      summary: observation.isError
        ? `旧错误：${observation.summary.slice(0, 160)}`
        : `旧观察：${observation.type}`
    };
  });
}

export function createAgentBudgetGuard(config: AgentCoreConfig) {
  const snapshot: AgentBudgetSnapshot = {
    failedFingerprints: {},
    observations: [],
    toolCalls: 0,
    turns: 0
  };

  return {
    getSnapshot(): AgentBudgetSnapshot {
      return {
        failedFingerprints: { ...snapshot.failedFingerprints },
        observations: [...snapshot.observations],
        toolCalls: snapshot.toolCalls,
        turns: snapshot.turns
      };
    },

    prepareTurn(input: { message: string; mode: string }): AgentBudgetDecision {
      const fingerprint = `${input.mode}:${normalizeMessage(input.message)}`;
      const repeatedFailures = snapshot.failedFingerprints[fingerprint] ?? 0;

      if (snapshot.turns >= config.budget.maxIterations) {
        return {
          allowed: false,
          message: "Agent 已达到本会话最大迭代预算。",
          recovery: "请先开启新会话，或缩小任务范围后再继续。"
        };
      }

      if (snapshot.toolCalls >= config.budget.maxToolCalls) {
        return {
          allowed: false,
          message: "Agent 已达到本会话最大工具调用预算。",
          recovery: "请使用已有结果继续判断，或开启新会话后再执行更多动作。"
        };
      }

      if (repeatedFailures >= 2) {
        return {
          allowed: false,
          message: "这个请求已经连续失败两次，Agent 不会继续用同一种方式重试。",
          recovery: "请换一种表述、补充上下文，或先手动完成缺失的前置条件。"
        };
      }

      return {
        allowed: true,
        fingerprint
      };
    },

    observeTurn(input: {
      events: AgentRuntimeEvent[];
      fingerprint: AgentTurnFingerprint;
    }) {
      snapshot.turns += 1;
      snapshot.toolCalls += input.events.filter((event) => event.type === "action_request").length;

      const failed = input.events.some(isFailureEvent);
      if (failed) {
        snapshot.failedFingerprints[input.fingerprint] =
          (snapshot.failedFingerprints[input.fingerprint] ?? 0) + 1;
      } else {
        delete snapshot.failedFingerprints[input.fingerprint];
      }

      snapshot.observations = compressObservations(
        [
          ...snapshot.observations,
          ...input.events.map((event) => ({
            isError: isFailureEvent(event),
            summary: getEventSummary(event),
            turnIndex: snapshot.turns,
            type: event.type
          }))
        ],
        config.budget.staleObservationTurns
      );
    },

    observeKnowledgeTurn(input: {
      failed?: boolean;
      fingerprint: AgentTurnFingerprint;
      summary: string;
    }) {
      snapshot.turns += 1;
      if (input.failed) {
        snapshot.failedFingerprints[input.fingerprint] =
          (snapshot.failedFingerprints[input.fingerprint] ?? 0) + 1;
      } else {
        delete snapshot.failedFingerprints[input.fingerprint];
      }

      snapshot.observations = compressObservations(
        [
          ...snapshot.observations,
          {
            isError: Boolean(input.failed),
            summary: input.summary,
            turnIndex: snapshot.turns,
            type: "knowledge_answer"
          }
        ],
        config.budget.staleObservationTurns
      );
    }
  };
}
