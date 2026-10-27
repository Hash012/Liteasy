import { createGuideGenerator } from "../features/paper-reading/literatureGuide";
import type { AcademicProfile } from "../features/profile/profile.types";
import type { ProfileMemory } from "../features/profile/profileMemory";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type { SettingsState } from "../features/settings/settings.types";
import type { Paper } from "../features/workspace/workspace.types";
import { useAnnotationStyle } from "../features/paper-reading/useAnnotationStyle";
import { resolveLocalAccountKey } from "../features/library/localAccountKey";

export function useLiteratureGuideController(input: {
  scopeId?: string; sessionGeneration?: number; getPapers?(): Paper[];
  getSettings(): SettingsState;
  profile: AcademicProfile;
  memory: ProfileMemory;
  samplingEnabled: boolean;
  transport?: ModelTransport;
}) {
  const annotationStyle = useAnnotationStyle({ ...input, scopeId: input.scopeId ?? resolveLocalAccountKey(),
    sessionGeneration: input.sessionGeneration ?? 0, getPapers: input.getPapers ?? (() => []) });
  const generate = createGuideGenerator(input.getSettings, () => ({
    level: input.profile.readingExplanation ?? "auto",
    context: [input.profile.researchFamiliarity ?? "",
      ...(input.samplingEnabled ? input.memory.entries.filter((entry) => entry.field === "research_familiarity").map((entry) => entry.value) : [])
    ].filter((value) => value.trim()).join("；").slice(0, 1600)
  }), input.transport);
  return Object.assign(generate, { annotationStyle });
}
