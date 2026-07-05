import type {
  RegisteredActionMetadata,
  SemanticActionFrame,
  SemanticActionSignal
} from "../skills/actionRegistry";
import type {
  PendingCommandClarification,
  RuntimeActionInvocation,
  SemanticClarificationCandidate
} from "./agentRuntime.types";

export type SemanticActionCandidateMatch =
  | {
      action: RuntimeActionInvocation;
      confidence: "high" | "medium";
      intentId: string;
      kind: "action";
      requiredContext: string[];
      requiresConfirmation?: boolean;
      riskLevel?: "low" | "medium" | "high";
      summary: string;
    }
  | {
      candidates: SemanticClarificationCandidate[];
      confidence: "medium";
      kind: "ambiguous_action";
      missing: string[];
      question: string;
    }
  | {
      kind: "not_command";
    }
  | {
      confidence: "medium";
      kind: "unsupported_action";
      question?: string;
      unsupportedReason: string;
    };

export type SemanticActionMatcherOptions = {
  registeredActions: RegisteredActionMetadata[];
};

export type SemanticFollowUpMatch =
  | {
      candidate: SemanticClarificationCandidate;
      kind: "candidate";
    }
  | {
      kind: "ambiguous";
    }
  | {
      kind: "none";
    };

export type SemanticFollowUpMatcherOptions = {
  pending?: PendingCommandClarification;
  registeredActions: RegisteredActionMetadata[];
};

type ScoredFrame = {
  action: RuntimeActionInvocation;
  frame: SemanticActionFrame;
  metadata: RegisteredActionMetadata;
  score: number;
};

const commandConcepts = new Set([
  "close",
  "create",
  "disable",
  "dock_move",
  "enable",
  "export",
  "focus",
  "import",
  "layout_change",
  "open",
  "sync",
  "theme_change"
]);

const unsupportedActionFrames = [
  {
    question: "我理解你想导出视频讲解，但当前动作目录还没有可执行的视频导出能力。",
    signals: [
      {
        aliases: ["导出", "生成", "制作"],
        concept: "export",
        required: true,
        weight: 3
      },
      {
        aliases: ["视频", "video", "视频讲解"],
        concept: "video",
        required: true,
        weight: 5
      }
    ],
    unsupportedReason: "未注册 video.export 或等价动作。"
  }
];

const conceptAliasLexicon: Record<string, string[]> = {
  academic_archive: ["研究档案", "学术资料档案"],
  academic_profile: ["学术人格", "学术身份", "研究画像"],
  close: ["别显示", "不要显示"],
  create: ["产出", "汇总成", "整理成"],
  open: ["带我去", "去", "看看", "看一下", "调出"],
  organization: ["团队", "团队空间", "组织空间"],
  shared_library: ["资料区", "资料库", "资料空间", "文献资料区", "团队资料区"],
  workspace: ["项目空间", "阅读空间"]
};

function normalize(input: string) {
  return input.trim().toLocaleLowerCase();
}

function compact(input: string) {
  return input.replace(/\s+/g, "");
}

export function hasExplicitCommandVerb(input: string) {
  return /打开|关闭|展开|显示|进入|切换|生成|制作|导入|同步|上传|删除|调整|开启|禁用|刷新|收藏|放到|放在|移到|移动到|挪到|拖到|停靠到/.test(input);
}

function signalMatches(input: string, signal: SemanticActionSignal) {
  const normalizedInput = normalize(input);
  const compactInput = compact(normalizedInput);
  const aliases = [
    ...signal.aliases,
    ...(conceptAliasLexicon[signal.concept] ?? [])
  ];

  return aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    return (
      normalizedInput.indexOf(normalizedAlias) >= 0 ||
      compactInput.indexOf(compact(normalizedAlias)) >= 0
    );
  });
}

function scoreSignals(input: string, signals: SemanticActionSignal[]) {
  let score = 0;
  const matchedConcepts = new Set<string>();

  for (const signal of signals) {
    const matched = signalMatches(input, signal);
    if (signal.required && !matched) {
      return null;
    }

    if (matched) {
      score += signal.weight;
      matchedConcepts.add(signal.concept);
    }
  }

  return {
    matchedConcepts,
    score
  };
}

function isRegisteredAction(metadataById: Map<string, RegisteredActionMetadata>, actionId: string) {
  return metadataById.has(actionId);
}

function toAction(metadata: RegisteredActionMetadata, frame: SemanticActionFrame): RuntimeActionInvocation {
  return {
    actionId: metadata.actionId,
    input: frame.input
  } as RuntimeActionInvocation;
}

function candidateIsRegistered(
  metadataById: Map<string, RegisteredActionMetadata>,
  candidate: SemanticClarificationCandidate
) {
  return isRegisteredAction(metadataById, candidate.actionId);
}

function hasCommandSignal(input: string, registeredActions: RegisteredActionMetadata[]) {
  const catalogSignals = registeredActions.flatMap((metadata) =>
    (metadata.semantic?.frames ?? []).flatMap((frame) => frame.signals)
  );
  const unsupportedSignals = unsupportedActionFrames.flatMap((frame) => frame.signals);

  return [...catalogSignals, ...unsupportedSignals].some(
    (signal) => commandConcepts.has(signal.concept) && signalMatches(input, signal)
  );
}

function matchUnsupportedAction(input: string) {
  return unsupportedActionFrames.find((frame) => scoreSignals(input, frame.signals));
}

function matchAmbiguityGroup(
  input: string,
  registeredActions: RegisteredActionMetadata[],
  metadataById: Map<string, RegisteredActionMetadata>
): SemanticActionCandidateMatch | null {
  for (const metadata of registeredActions) {
    for (const group of metadata.semantic?.ambiguityGroups ?? []) {
      if (!scoreSignals(input, group.signals)) {
        continue;
      }

      const candidates = group.candidates.filter((candidate) =>
        candidateIsRegistered(metadataById, candidate)
      );
      if (candidates.length < 2) {
        continue;
      }

      return {
        candidates,
        confidence: "medium",
        kind: "ambiguous_action",
        missing: group.missing,
        question: group.question
      };
    }
  }

  return null;
}

function getScoredFrames(
  input: string,
  registeredActions: RegisteredActionMetadata[]
): ScoredFrame[] {
  const scoredFrames: ScoredFrame[] = [];

  for (const metadata of registeredActions) {
    for (const frame of metadata.semantic?.frames ?? []) {
      const score = scoreSignals(input, frame.signals);
      if (!score) {
        continue;
      }

      scoredFrames.push({
        action: toAction(metadata, frame),
        frame,
        metadata,
        score: score.score + (frame.priority ?? 0)
      });
    }
  }

  return scoredFrames.sort((left, right) => right.score - left.score);
}

function getFrameForCandidate(
  candidate: SemanticClarificationCandidate,
  registeredActions: RegisteredActionMetadata[]
) {
  const metadata = registeredActions.find(
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

function scoreFollowUpCandidate(
  input: string,
  candidate: SemanticClarificationCandidate,
  registeredActions: RegisteredActionMetadata[]
) {
  const inputText = compact(normalize(input));
  const labelText = compact(normalize(candidate.label));
  const labelWithoutLeadingVerb = labelText.replace(/^(打开|关闭|展开|显示|进入|切换到?)/, "");
  let score = 0;

  if (labelText === inputText || labelWithoutLeadingVerb === inputText) {
    score += 20;
  } else if (labelText.includes(inputText) || inputText.includes(labelWithoutLeadingVerb)) {
    score += 12;
  }

  const { frame } = getFrameForCandidate(candidate, registeredActions);
  if (frame?.clarificationLabel) {
    const clarificationLabel = compact(normalize(frame.clarificationLabel));
    const clarificationWithoutVerb = clarificationLabel.replace(/^(打开|关闭|展开|显示|进入|切换到?)/, "");
    if (clarificationLabel === inputText || clarificationWithoutVerb === inputText) {
      score += 20;
    } else if (clarificationLabel.includes(inputText)) {
      score += 12;
    }
  }

  return score;
}

export function matchSemanticFollowUpCandidate(
  input: string,
  options: SemanticFollowUpMatcherOptions
): SemanticFollowUpMatch {
  const candidates = options.pending?.clarification.candidates ?? [];
  if (options.pending?.clarification.kind !== "ambiguous_action" || candidates.length === 0) {
    return {
      kind: "none"
    };
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreFollowUpCandidate(input, candidate, options.registeredActions)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const [best, second] = ranked;
  if (!best) {
    return {
      kind: "none"
    };
  }

  if (second && second.score === best.score) {
    return {
      kind: "ambiguous"
    };
  }

  return {
    candidate: best.candidate,
    kind: "candidate"
  };
}

export function matchSemanticActionCandidates(
  input: string,
  options: SemanticActionMatcherOptions
): SemanticActionCandidateMatch {
  const metadataById = new Map(options.registeredActions.map((metadata) => [metadata.actionId, metadata]));
  const scoredFrames = getScoredFrames(input, options.registeredActions);

  if (scoredFrames.length > 0) {
    const [best, second] = scoredFrames;
    if (second && second.score === best.score && second.action.actionId !== best.action.actionId) {
      return {
        candidates: [best, second].map((match) => ({
          actionId: match.action.actionId,
          input: match.action.input,
          label: match.frame.clarificationLabel ?? match.metadata.label
        })),
        confidence: "medium",
        kind: "ambiguous_action",
        missing: ["ambiguous_action"],
        question: "这条命令可能对应多个动作。请选择要执行的动作。"
      };
    }

    return {
      action: best.action,
      confidence: best.score >= 6 ? "high" : "medium",
      intentId: best.frame.intentId,
      kind: "action",
      requiredContext: best.frame.requiredContext ?? best.metadata.requiredContext,
      requiresConfirmation: best.frame.requiresConfirmation,
      riskLevel: best.frame.riskLevel,
      summary: best.frame.summary
    };
  }

  const ambiguity = matchAmbiguityGroup(input, options.registeredActions, metadataById);
  if (ambiguity) {
    return ambiguity;
  }

  const unsupported = matchUnsupportedAction(input);
  if (unsupported) {
    return {
      confidence: "medium",
      kind: "unsupported_action",
      question: unsupported.question,
      unsupportedReason: unsupported.unsupportedReason
    };
  }

  if (!hasCommandSignal(input, options.registeredActions)) {
    return {
      kind: "not_command"
    };
  }

  return {
    confidence: "medium",
    kind: "unsupported_action",
    unsupportedReason: "当前命令没有匹配到已注册动作。"
  };
}
