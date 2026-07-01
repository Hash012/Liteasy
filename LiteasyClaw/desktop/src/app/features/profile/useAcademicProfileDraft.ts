import { useEffect, useState } from "react";
import type { AcademicProfile } from "./profile.types";

type UseAcademicProfileDraftInput = {
  academicProfile: AcademicProfile;
  onSave: (profile: AcademicProfile) => void;
};

export function normalizeAcademicProfileDraft(profile: AcademicProfile): AcademicProfile {
  return {
    age: profile.age.trim() || "未设置",
    gender: profile.gender,
    stage: profile.stage
  };
}

export function getVisibleAcademicProfileAge(profile: AcademicProfile) {
  return profile.age === "未设置" ? "" : profile.age;
}

export function useAcademicProfileDraft({ academicProfile, onSave }: UseAcademicProfileDraftInput) {
  const [draftProfile, setDraftProfile] = useState<AcademicProfile>(academicProfile);

  useEffect(() => {
    setDraftProfile(academicProfile);
  }, [academicProfile]);

  function updateDraftProfile(field: keyof AcademicProfile, value: string) {
    setDraftProfile((currentProfile) => ({ ...currentProfile, [field]: value }));
  }

  function saveAcademicProfile() {
    onSave(normalizeAcademicProfileDraft(draftProfile));
  }

  return {
    draftProfile,
    saveAcademicProfile,
    updateDraftProfile,
    visibleAge: getVisibleAcademicProfileAge(draftProfile)
  };
}
