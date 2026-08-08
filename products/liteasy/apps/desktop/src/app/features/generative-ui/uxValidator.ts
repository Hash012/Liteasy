import type {
  UIDslActionRef,
  UIDslDocument,
  UIDslNode,
  UIDslValidationResult
} from "./generativeUi.types";

const cardComponents = new Set(["EvidenceCard", "Panel", "StatusBanner"]);
const modalComponents = new Set(["Modal"]);
const longTextLimit = 240;
const executableStringPattern = /(=>|function\s*\(|document\.|window\.|eval\s*\(|<script)/i;

export type ModelUxReviewInput = {
  document: UIDslDocument;
};

export type GenerateModelUxReview = (
  input: ModelUxReviewInput
) => Promise<string> | string;

function getStringProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return typeof value === "string" ? value : undefined;
}

function getActionsById(actions: UIDslActionRef[]) {
  return new Map(actions.map((action) => [action.id, action]));
}

function validateActionLabels(actions: UIDslActionRef[], errors: string[]) {
  for (const action of actions) {
    if (action.label.trim().length === 0) {
      errors.push(`Action ${action.id} requires a visible label`);
    }
  }
}

function validateNodeUx(
  node: UIDslNode,
  document: UIDslDocument,
  actionsById: Map<string, UIDslActionRef>,
  path: string,
  cardDepth: number,
  modalDepth: number,
  errors: string[]
) {
  const nextCardDepth = document.surface === "assistant" && cardComponents.has(node.component)
    ? cardDepth + 1
    : cardDepth;
  const nextModalDepth = modalComponents.has(node.component) ? modalDepth + 1 : modalDepth;

  if (nextCardDepth > 3) {
    errors.push(`Assistant card depth cannot exceed 3 at ${path}`);
  }

  if (nextModalDepth > 1) {
    errors.push(`Modal stacking is not allowed at ${path}`);
  }

  const text = getStringProp(node.props, "text");
  if (text && text.length > longTextLimit) {
    const strategy = getStringProp(node.props, "longTextStrategy");
    if (strategy !== "collapse" && strategy !== "scroll") {
      errors.push(`Long text requires collapse or scroll strategy at ${path}`);
    }
  }

  if (node.component === "ActionBar") {
    const primaryActionId = getStringProp(node.props, "primaryActionId");
    if (primaryActionId) {
      const action = actionsById.get(primaryActionId);
      if (action?.riskLevel === "high") {
        errors.push(`High-risk actions cannot be primary at ${path}`);
      }
    }
  }

  if (node.component === "EvidenceCard") {
    const snippet = getStringProp(node.props, "snippet");
    const source = getStringProp(node.props, "source");
    if (!snippet || !source) {
      errors.push(`EvidenceCard requires consistent source and snippet at ${path}`);
    }
  }

  node.children?.forEach((child, index) => {
    validateNodeUx(
      child,
      document,
      actionsById,
      `${path}.children[${index}]`,
      nextCardDepth,
      nextModalDepth,
      errors
    );
  });
}

export function validateUIDslUx(document: UIDslDocument): UIDslValidationResult {
  const errors: string[] = [];
  const actionsById = getActionsById(document.actions);

  validateActionLabels(document.actions, errors);
  validateNodeUx(document.root, document, actionsById, "root", 0, 0, errors);

  return {
    errors,
    valid: errors.length === 0
  };
}

function isSafeModelUxError(error: string) {
  return error.trim().length > 0 && !executableStringPattern.test(error);
}

function parseModelUxReview(rawReview: string): UIDslValidationResult | null {
  const parsed: unknown = JSON.parse(rawReview);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as { errors?: unknown; valid?: unknown };
  if (typeof candidate.valid !== "boolean" || !Array.isArray(candidate.errors)) {
    return null;
  }

  const errors = candidate.errors.filter(
    (error): error is string => typeof error === "string" && isSafeModelUxError(error)
  );
  if (!candidate.valid && errors.length === 0) {
    return null;
  }

  return {
    errors,
    valid: candidate.valid
  };
}

export async function validateUIDslUxWithModelFallback(
  document: UIDslDocument,
  options: {
    generateModelUxReview?: GenerateModelUxReview;
  } = {}
): Promise<UIDslValidationResult> {
  const deterministicResult = validateUIDslUx(document);
  if (!deterministicResult.valid || !options.generateModelUxReview) {
    return deterministicResult;
  }

  try {
    const rawReview = await options.generateModelUxReview({ document });
    const modelResult = parseModelUxReview(rawReview);
    if (!modelResult) {
      return deterministicResult;
    }

    return modelResult.valid
      ? deterministicResult
      : {
          errors: modelResult.errors,
          valid: false
        };
  } catch {
    return deterministicResult;
  }
}
