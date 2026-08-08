import type { UIDslDocument, UIDslNode } from "./generativeUi.types";

export type FallbackUiReason =
  | "clarify"
  | "deny"
  | "runtime_error"
  | "dsl_error"
  | "ux_risk"
  | "model_failure";

export type FallbackUiInput = {
  baseDocument?: UIDslDocument;
  message: string;
  planId: string;
  reason: FallbackUiReason;
  recovery?: string;
  traceId: string;
};

function createStatusNode(input: FallbackUiInput): UIDslNode {
  return {
    component: "StatusBanner",
    id: "fallback-status",
    props: {
      text: input.message,
      tone: input.reason === "clarify" ? "info" : "warning"
    }
  };
}

function createRecoveryNode(recovery: string): UIDslNode {
  return {
    component: "Panel",
    id: "fallback-recovery",
    props: {
      text: recovery,
      title: "恢复路径"
    }
  };
}

export function createFallbackUIDslDocument(input: FallbackUiInput): UIDslDocument {
  const children = [
    createStatusNode(input),
    ...(input.recovery ? [createRecoveryNode(input.recovery)] : []),
    ...(input.baseDocument ? [input.baseDocument.root] : [])
  ];

  return {
    actions: input.baseDocument?.actions ?? [],
    audit: {
      createdAt: new Date().toISOString(),
      generatedBy: "rule",
      traceId: input.traceId
    },
    dataSources: [
      {
        id: "fallback-runtime-context",
        params: {
          reason: input.reason
        },
        sourceId: "runtime.context_view"
      },
      ...(input.baseDocument?.dataSources ?? [])
    ],
    id: `fallback-${input.planId}-${input.reason}`,
    intentPlanId: input.planId,
    root: {
      children,
      component: "Stack",
      id: "fallback-root",
      props: {
        direction: "vertical",
        gap: "sm"
      }
    },
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}
