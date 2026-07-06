import {
  getRegisteredActionMetadata,
  getRuntimeActionPolicy
} from "../skills/actionRegistry";
import type { ActionInvocation } from "../skills/actionRegistry";
import type {
  AgentRuntimeInput,
  RuntimeActionInvocation,
  SemanticActionPlan,
  SemanticClarificationCandidate,
  SemanticFallbackExplanation,
  SemanticPlannerContext
} from "./agentRuntime.types";
import {
  hasExplicitCommandVerb,
  matchSemanticActionCandidates,
  matchSemanticFollowUpCandidate
} from "./semanticActionMatcher";

function createPlanId(input: string) {
  return `plan-${input.length}-${input.charCodeAt(0) || 0}`;
}

function createBasePlan(input: string): Omit<SemanticActionPlan, "actions" | "intentId" | "summary"> {
  return {
    confidence: "high",
    planId: createPlanId(input),
    plannerSource: "rule",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  };
}

function createFallbackQuestion(input: string, fallback: SemanticFallbackExplanation) {
  const alternatives = fallback.alternatives.map((item) => `“${item}”`).join("");

  return `我理解“${input}”${fallback.understoodAs}，但它还没有对应到可执行动作。请补充要解释、生成、打开、同步、上传、删除或调整的对象；也可以改说${alternatives}。`;
}

function createAmbiguousFallback(
  context?: SemanticPlannerContext
): SemanticFallbackExplanation {
  const selection = context?.contextView?.selection;
  const hasReadySelection = Boolean(selection?.ready && selection.selectedCount > 0);

  if (hasReadySelection && selection) {
    return {
      alternatives: ["解释 ABC", "生成思维导图", "导入当前选中文献集"],
      cannotExecuteBecause: "当前命令没有明确的软件动作或目标对象。",
      needs: ["明确动作", "明确对象"],
      understoodAs: `可能是在指当前已锁定的 ${selection.selectedCount} 篇选中文献中的术语、缩写或对象`
    };
  }

  return {
    alternatives: ["打开设置面板", "生成思维导图", "导入当前选中文献集"],
    cannotExecuteBecause: "当前上下文里它还没有对应到可执行对象或动作。",
    needs: ["明确动作", "明确对象"],
    understoodAs: "可能想让软件处理这段文本"
  };
}

function createClarificationPlan(input: string, options: {
  candidates?: SemanticClarificationCandidate[];
  confidence?: SemanticActionPlan["confidence"];
  fallback?: SemanticFallbackExplanation;
  kind: NonNullable<SemanticActionPlan["clarification"]>["kind"];
  missing: string[];
  question: string;
  unsupportedReason?: string;
}): SemanticActionPlan {
  return {
    ...createBasePlan(input),
    actions: [],
    clarification: {
      candidates: options.candidates,
      kind: options.kind,
      missing: options.missing,
      question: options.question
    },
    confidence: options.confidence ?? "low",
    fallback: options.fallback,
    intentId: "unknown",
    summary: "需要澄清命令意图",
    unsupportedReason: options.unsupportedReason
  };
}

function createActionPlan(
  input: string,
  match: Extract<ReturnType<typeof matchSemanticActionCandidates>, { kind: "action" }>
): SemanticActionPlan {
  const policy = getRuntimeActionPolicy(match.action as ActionInvocation);

  return {
    ...createBasePlan(input),
    actions: [match.action],
    confidence: match.confidence,
    intentId: match.intentId as SemanticActionPlan["intentId"],
    requiredContext: match.requiredContext,
    requiresConfirmation: match.requiresConfirmation ?? policy.requiresConfirmation,
    riskLevel: match.riskLevel ?? policy.riskLevel,
    summary: match.summary
  };
}

function getFrameForCandidate(
  candidate: SemanticClarificationCandidate,
  context: SemanticPlannerContext
) {
  const metadata = context.registeredActions.find(
    (registeredAction) => registeredAction.actionId === candidate.actionId
  );
  const frame = metadata?.semantic?.frames.find(
    (item) => JSON.stringify(item.input) === JSON.stringify(candidate.input)
  );

  return {
    frame,
    metadata
  };
}

function createActionPlanFromCandidate(
  input: string,
  candidate: SemanticClarificationCandidate,
  context: SemanticPlannerContext
): SemanticActionPlan | null {
  const { frame, metadata } = getFrameForCandidate(candidate, context);
  if (!metadata) {
    return null;
  }

  const action = {
    actionId: candidate.actionId,
    input: candidate.input
  } as RuntimeActionInvocation;
  const policy = getRuntimeActionPolicy(action as ActionInvocation);

  return {
    ...createBasePlan(input),
    actions: [action],
    confidence: "high",
    intentId: (frame?.intentId ?? "unknown") as SemanticActionPlan["intentId"],
    requiredContext: frame?.requiredContext ?? metadata.requiredContext,
    requiresConfirmation: frame?.requiresConfirmation ?? policy.requiresConfirmation,
    riskLevel: frame?.riskLevel ?? policy.riskLevel,
    summary: frame?.summary ?? candidate.label
  };
}

function createNotCommandPlan(
  input: string,
  context?: SemanticPlannerContext
): SemanticActionPlan {
  const fallback = createAmbiguousFallback(context);
  const selectedSetHint =
    fallback.understoodAs === "可能想让软件处理这段文本"
      ? ""
      : `它也可能是在指当前已锁定的 ${context?.contextView?.selection.selectedCount ?? 0} 篇选中文献中的术语、缩写或对象。`;

  return createClarificationPlan(input, {
    fallback,
    kind: "not_command",
    missing: ["not_command"],
    question: `我不确定“${input}”是在要求 LiteasyClaw 执行软件动作。${selectedSetHint}你可以切换到问答/名词解释，或明确说要打开、生成、切换、导入、同步、上传、删除还是调整什么。`
  });
}

function createUnsupportedPlan(
  input: string,
  question: string | undefined,
  unsupportedReason: string,
  context?: SemanticPlannerContext
): SemanticActionPlan {
  const fallback = createAmbiguousFallback(context);
  const fallbackQuestion =
    fallback.understoodAs === "可能想让软件处理这段文本"
      ? `我理解你可能想让软件处理“${input}”，但当前上下文里它还没有对应到可执行对象或动作。请补充要打开、生成、切换、调整或分析的对象；也可以改说“打开设置面板”“生成思维导图”“导入当前选中文献集”。`
      : createFallbackQuestion(input, fallback);

  return createClarificationPlan(input, {
    confidence: "medium",
    fallback,
    kind: "unsupported_action",
    missing: ["unsupported_action"],
    question: question ?? fallbackQuestion,
    unsupportedReason
  });
}

function isBottomOpenWithoutDockItem(input: string) {
  const compactInput = input.replace(/\s+/g, "");
  const asksForBottomOpen =
    /打开|展开|显示|调出/.test(compactInput) && /下栏|底栏|下面|下方|底部/.test(compactInput);
  const mentionsDockItem =
    /AI助手|助手|聊天助手|LiteasyChat|文献库|组织|个人中心|个人画像|画像|设置/.test(compactInput);
  const mentionsDockMove = /放到|放在|移到|移动到|挪到|拖到|停靠到/.test(compactInput);

  return asksForBottomOpen && !mentionsDockItem && !mentionsDockMove;
}

export function planSemanticCommand(
  input: AgentRuntimeInput,
  context?: SemanticPlannerContext
): SemanticActionPlan {
  const message = input.message.trim();
  const base = createBasePlan(message);

  if (input.mode !== "command") {
    return {
      ...base,
      actions: [],
      clarification: {
        kind: "command_mode",
        missing: ["command_mode"],
        question: "当前模式不执行软件动作，请切换到命令模式。"
      },
      confidence: "low",
      intentId: "unknown",
      summary: "当前模式不执行软件动作"
    };
  }

  const followUpMatch = context
    ? matchSemanticFollowUpCandidate(message, {
        pending: context.pendingClarification,
        registeredActions: context.registeredActions
      })
    : { kind: "none" as const };
  if (followUpMatch.kind === "candidate" && context) {
    const followUpPlan = createActionPlanFromCandidate(message, followUpMatch.candidate, context);
    if (followUpPlan) {
      return followUpPlan;
    }
  }

  if (
    context?.pendingClarification?.clarification.kind === "ambiguous_action" &&
    !hasExplicitCommandVerb(message)
  ) {
    return createClarificationPlan(message, {
      candidates: context.pendingClarification.clarification.candidates,
      confidence: "medium",
      kind: "ambiguous_action",
      missing: context.pendingClarification.clarification.missing,
      question: context.pendingClarification.clarification.question
    });
  }

  if (isBottomOpenWithoutDockItem(message)) {
    return createClarificationPlan(message, {
      confidence: "medium",
      kind: "missing_context",
      missing: ["dock_item"],
      question: "要把哪个标签页放到下栏？例如：把 AI 助手放到下栏。"
    });
  }

  const match = matchSemanticActionCandidates(message, {
    registeredActions: context?.registeredActions ?? getRegisteredActionMetadata()
  });

  if (match.kind === "action") {
    return createActionPlan(message, match);
  }

  if (match.kind === "ambiguous_action") {
    return createClarificationPlan(message, {
      candidates: match.candidates,
      confidence: match.confidence,
      kind: "ambiguous_action",
      missing: match.missing,
      question: match.question
    });
  }

  if (match.kind === "not_command") {
    return createNotCommandPlan(message, context);
  }

  return createUnsupportedPlan(
    message,
    match.question,
    match.unsupportedReason,
    context
  );
}
