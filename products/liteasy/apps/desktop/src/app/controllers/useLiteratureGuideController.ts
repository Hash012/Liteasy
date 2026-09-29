import { createGuideGenerator } from "../features/paper-reading/literatureGuide";
import type { AcademicProfile } from "../features/profile/profile.types";
import type { ProfileMemory } from "../features/profile/profileMemory";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type { SettingsState } from "../features/settings/settings.types";

export function useLiteratureGuideController(input: {
  getSettings(): SettingsState;
  profile: AcademicProfile;
  memory: ProfileMemory;
  samplingEnabled: boolean;
  transport?: ModelTransport;
}) {
  return createGuideGenerator(input.getSettings, () => ({
    level: input.profile.readingExplanation ?? "auto",
    context: [input.profile.researchFamiliarity ?? "",
      ...(input.samplingEnabled ? input.memory.entries.filter((entry) => entry.field === "research_familiarity").map((entry) => entry.value) : [])
    ].filter((value) => value.trim()).join("；").slice(0, 1600)
  }), input.transport);
}
