import type { ArtifactType } from "../artifacts/artifact.types";
import type { ActionContext, ActionResult } from "./actionRegistry";
import { invokeAction } from "../agent-runtime/invokeAction";
import type { UpdateSettingCommand } from "../settings/settings.types";

export {
  getBuiltinSkillSummary
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
  const execute = async (actionId: string, actionInput: unknown) => {
    const result = await invokeAction(actionId, actionInput, context);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.output;
  };

  if (invocation.skillId === "settings.adjust") {
    return execute("settings.update", invocation.input);
  }

  if (invocation.skillId === "organization.open_shared_library") {
    return execute("organization.open_shared_library", invocation.input);
  }

  return execute("artifact.generate", invocation.input);
}
