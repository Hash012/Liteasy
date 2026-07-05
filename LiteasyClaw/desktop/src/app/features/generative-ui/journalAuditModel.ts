import type { ExecutionJournalEntry } from "./executionJournal";
import type { UIDslDocument, UIDslNode } from "./generativeUi.types";
import { validateUIDslDocument } from "./uiDslValidator";
import { validateUIDslUx } from "./uxValidator";
import { getDefaultModelForProvider } from "../models/modelPolicy";
import type { ModelTransport } from "../models/modelHttpClient";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import type { SettingsState } from "../settings/settings.types";

type JournalAuditOptions = {
  traceId: string;
};

type ModelJournalAuditOptions = JournalAuditOptions & {
  generateModelAudit: (input: {
    fallbackDocument: UIDslDocument;
    trace: ExecutionJournalEntry[];
  }) => Promise<string> | string;
  model: string;
};

type ModelJournalAuditPayload = {
  summary: string;
  verdict: "fail" | "pass" | "review";
};

type ModelAssistedJournalAuditInput = {
  trace: ExecutionJournalEntry[];
  traceId: string;
};

function countEntries(trace: ExecutionJournalEntry[], type: ExecutionJournalEntry["type"]) {
  return trace.filter((entry) => entry.type === type).length;
}

function createStatusNode(text: string): UIDslNode {
  return {
    component: "StatusBanner",
    id: "journal-audit-status",
    props: {
      text,
      tone: "info"
    }
  };
}

function createFactSummaryNode(trace: ExecutionJournalEntry[]): UIDslNode {
  const inputCount = countEntries(trace, "input");
  const planCount = countEntries(trace, "plan");
  const policyCount = countEntries(trace, "policy");
  const actionCount = countEntries(trace, "action_result");
  const uiCount = countEntries(trace, "ui_dsl");
  const confirmationCount = countEntries(trace, "confirmation");
  const confirmationText = confirmationCount > 0 ? ` · 确认 ${confirmationCount} 条` : "";

  return {
    component: "Panel",
    id: "journal-audit-facts",
    props: {
      text: `输入 ${inputCount} 条 · 计划 ${planCount} 条 · 策略 ${policyCount} 条 · 执行 ${actionCount} 条 · UI ${uiCount} 条${confirmationText}`,
      title: "Journal Audit Model"
    }
  };
}

function isModelJournalAuditPayload(value: unknown): value is ModelJournalAuditPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "summary" in value &&
    typeof value.summary === "string" &&
    "verdict" in value &&
    (value.verdict === "pass" || value.verdict === "review" || value.verdict === "fail")
  );
}

function createModelCommentaryNode(payload: ModelJournalAuditPayload): UIDslNode {
  return {
    component: "Panel",
    id: "journal-audit-model-commentary",
    props: {
      text: payload.summary,
      title: `Audit Model ${payload.verdict}`
    }
  };
}

export function auditExecutionJournalTrace(
  trace: ExecutionJournalEntry[],
  options: JournalAuditOptions
): UIDslDocument {
  const snapshot = trace.map((entry) => ({ ...entry }));

  return {
    actions: [],
    audit: {
      createdAt: new Date().toISOString(),
      generatedBy: "rule",
      traceId: options.traceId
    },
    dataSources: [
      {
        id: "journal-trace",
        params: {
          factCount: snapshot.length,
          traceId: options.traceId
        },
        sourceId: "runtime.context_view"
      }
    ],
    id: `ui-audit-${options.traceId.replace(/^trace-/, "")}`,
    intentPlanId: `audit-${options.traceId}`,
    root: {
      children: [
        createStatusNode(`执行审计：已回放 ${snapshot.length} 条 journal 事实。`),
        createFactSummaryNode(snapshot)
      ],
      component: "Stack",
      id: "journal-audit-root",
      props: {
        direction: "vertical",
        gap: "sm"
      }
    },
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}

export async function generateJournalAuditWithModelFallback(
  trace: ExecutionJournalEntry[],
  options: ModelJournalAuditOptions
): Promise<UIDslDocument> {
  const snapshot = trace.map((entry) => ({ ...entry }));
  const fallbackDocument = auditExecutionJournalTrace(snapshot, {
    traceId: options.traceId
  });

  try {
    const rawPayload = await options.generateModelAudit({
      fallbackDocument,
      trace: snapshot
    });
    const parsed: unknown = JSON.parse(rawPayload);

    if (!isModelJournalAuditPayload(parsed)) {
      return fallbackDocument;
    }

    const document: UIDslDocument = {
      ...fallbackDocument,
      audit: {
        ...fallbackDocument.audit,
        generatedBy: "model",
        model: options.model
      },
      root: {
        ...fallbackDocument.root,
        children: [
          ...(fallbackDocument.root.children ?? []),
          createModelCommentaryNode(parsed)
        ]
      }
    };
    const dslValidation = validateUIDslDocument(document);
    const uxValidation = dslValidation.valid
      ? validateUIDslUx(document)
      : { errors: [], valid: true };

    if (!dslValidation.valid || !uxValidation.valid) {
      return fallbackDocument;
    }

    return document;
  } catch {
    return fallbackDocument;
  }
}

function createJournalAuditPrompt(input: {
  fallbackDocument: UIDslDocument;
  trace: ExecutionJournalEntry[];
}) {
  return [
    "你是 LiteasyClaw 的 Answer / UI Audit Model。",
    "只输出 JSON，不要输出 Markdown。",
    "输出 schema：{\"summary\": string, \"verdict\": \"pass\" | \"review\" | \"fail\"}。",
    "你只能解释审计结果，不改写 journal 事实、traceId、执行记录、策略记录或 UI DSL factCount。",
    "如果证据不足，verdict 使用 review。",
    `journal 事实：${JSON.stringify(input.trace)}`,
    `规则审计 UI：${JSON.stringify(input.fallbackDocument)}`
  ].join("\n");
}

export function createModelAssistedJournalAuditModel(input: {
  modelTransport?: ModelTransport;
  settings: SettingsState;
}) {
  return async (request: ModelAssistedJournalAuditInput) => {
    return generateJournalAuditWithModelFallback(request.trace, {
      generateModelAudit: async ({ fallbackDocument, trace }) => {
        const provider = input.settings["models.default_provider"];
        const model = getDefaultModelForProvider(provider);
        const gateway = createModelGatewayFromSettings(input.settings, {
          cloudTransport: input.modelTransport
        });
        const generation = await gateway.generateAnswer({
          model,
          prompt: createJournalAuditPrompt({
            fallbackDocument,
            trace
          }),
          provider
        });

        return generation.answer;
      },
      model: getDefaultModelForProvider(input.settings["models.default_provider"]),
      traceId: request.traceId
    });
  };
}
