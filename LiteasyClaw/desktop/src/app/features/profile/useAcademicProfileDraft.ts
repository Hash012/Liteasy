import { useEffect, useState } from "react";
import type { AcademicProfile } from "./profile.types";
import { splitResearchProfileValues } from "./profile.types";

type UseAcademicProfileDraftInput = {
  academicProfile: AcademicProfile;
  onSave: (profile: AcademicProfile) => void | Promise<void>;
};

export function normalizeAcademicProfileDraft(profile: AcademicProfile): AcademicProfile {
  const normalizeResearchField = (value: string, limit?: number) =>
    splitResearchProfileValues(value, limit).join("、");
  return {
    age: profile.age.trim() || "未设置",
    disciplines: profile.disciplines.map((discipline) => ({
      ...discipline,
      description: discipline.description.trim()
    })),
    gender: profile.gender,
    preferredLanguages: normalizeResearchField(profile.preferredLanguages, 6),
    researchDatasets: normalizeResearchField(profile.researchDatasets),
    researchMethods: normalizeResearchField(profile.researchMethods),
    researchTopics: normalizeResearchField(profile.researchTopics),
    stage: profile.stage
  };
}

export function useAcademicProfileDraft({ academicProfile, onSave }: UseAcademicProfileDraftInput) {
  const [draftProfile, setDraftProfile] = useState<AcademicProfile>(academicProfile);

  useEffect(() => {
    setDraftProfile(academicProfile);
  }, [academicProfile]);

  function updateDraftProfile<K extends keyof AcademicProfile>(field: K, value: AcademicProfile[K]) {
    setDraftProfile((currentProfile) => ({ ...currentProfile, [field]: value }));
  }

  function saveAcademicProfile() {
    return onSave(normalizeAcademicProfileDraft(draftProfile));
  }

  return { draftProfile, saveAcademicProfile, updateDraftProfile };
}
