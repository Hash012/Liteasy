import type { ArtifactType } from "../artifacts/artifact.types";
import { executeAction } from "./actionRegistry";
import type { ActionContext, ActionResult } from "./actionRegistry";
import type { UpdateSettingCommand } from "../settings/settings.types";

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
      skillId: "settings.sync_policy";
      input: {
        source: "cloud_control_plane";
      };
    }
  | {
      skillId: "settings.use_local_dev_cloud";
      input: {
        target: "local_dev_cloud";
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

  if (invocation.skillId === "settings.sync_policy") {
    return executeAction(
      {
        actionId: "settings.sync_model_policy",
        input: invocation.input
      },
      context
    );
  }

  if (invocation.skillId === "settings.use_local_dev_cloud") {
    return executeAction(
      {
        actionId: "settings.use_local_dev_cloud",
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
      actionId: "artifact.start_analysis",
      input: invocation.input
    },
    context
  );
}
