import type { ArtifactType } from "../artifacts/artifact.types";
import { executeAction } from "./actionRegistry";
import type { ActionContext, ActionResult } from "./actionRegistry";
import type { UpdateSettingCommand } from "../settings/settings.types";

export {
  getBuiltinSkillSummary,
  loadBuiltinSkill,
  registerBuiltinSkill
} from "./builtinSkillRegistry";

export type SkillInvocation =
  | {
      skillId: "settings.adjust";
      input: {
        target: UpdateSettingCommand["target"];
        value: UpdateSettingCommand["value"];
      };
    }
  | {
      skillId: "artifact.generate";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      skillId: "organization.open_shared_library";
      input: {
        source: "organization_space";
      };
    };

export async function executeSkill(
  invocation: SkillInvocation,
  context: ActionContext
): Promise<ActionResult> {
  if (invocation.skillId === "settings.adjust") {
    return executeAction(
      {
        actionId: "settings.update",
        input: invocation.input
      },
      context
    );
  }

  if (invocation.skillId === "organization.open_shared_library") {
    return executeAction(
      {
        actionId: "organization.open_shared_library",
        input: invocation.input
      },
      context
    );
  }

  return executeAction(
    {
      actionId: "artifact.generate",
      input: invocation.input
    },
    context
  );
}
