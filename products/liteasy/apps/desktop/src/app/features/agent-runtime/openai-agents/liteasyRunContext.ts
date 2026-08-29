import type { InvokeActionContext, InvokeActionResult } from "../invokeAction";

export type LiteasyRunContext = {
  actionContext: InvokeActionContext;
  actionResults: Array<{
    input: Record<string, unknown>;
    result: InvokeActionResult;
  }>;
  runId: string;
};

export function createLiteasyRunContext(input: {
  actionContext: InvokeActionContext;
  runId: string;
}): LiteasyRunContext {
  return {
    actionContext: input.actionContext,
    actionResults: [],
    runId: input.runId
  };
}
