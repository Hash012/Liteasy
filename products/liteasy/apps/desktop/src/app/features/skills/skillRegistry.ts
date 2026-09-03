import type { ActionContext, ActionResult } from "./actionRegistry";
import {
  executeActionWorkflowSkill
} from "./workflowSkillRegistry";
import type { WorkflowSkillInvocation } from "./workflowSkill.types";

export {
  getBuiltinSkillSummary
} from "./builtinSkillRegistry";

export type SkillInvocation = WorkflowSkillInvocation;

export async function executeSkill(
  invocation: SkillInvocation,
  context: ActionContext
): Promise<ActionResult> {
  const result = await executeActionWorkflowSkill(invocation, {
    actionContext: context
  });
  return result.output;
}
