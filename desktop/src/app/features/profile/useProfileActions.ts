import { useState } from "react";
import type { AcademicProfile } from "./profile.types";
import { defaultAcademicProfile } from "./profile.types";

type UseProfileActionsInput = {
  onProfileSamplingChanged?: (enabled: boolean) => void;
  profileSamplingEnabled?: boolean;
};

export function useProfileActions({
  onProfileSamplingChanged,
  profileSamplingEnabled = false
}: UseProfileActionsInput = {}) {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [academicProfile, setAcademicProfile] = useState<AcademicProfile>(defaultAcademicProfile);
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [profileClearMessage, setProfileClearMessage] = useState<string | undefined>();

  function openAcademicArchive() {
    setAcademicArchiveOpen(true);
  }

  function closeAcademicArchive() {
    setAcademicArchiveOpen(false);
  }

  function openClearProfileConfirm() {
    setClearProfileConfirmOpen(true);
  }

  function closeClearProfileConfirm() {
    setClearProfileConfirmOpen(false);
  }

  function toggleProfileSampling() {
    setProfileClearMessage(undefined);
    onProfileSamplingChanged?.(!profileSamplingEnabled);
  }

  function updateAcademicProfile(nextProfile: AcademicProfile) {
    setAcademicProfile(nextProfile);
    setProfileClearMessage("画像配置已更新。");
  }

  function clearUserProfile() {
    setAcademicProfile(defaultAcademicProfile);
    setClearProfileConfirmOpen(false);
    setProfileClearMessage("用户画像已清空，基础身份信息已保留。");
    onProfileSamplingChanged?.(false);
  }

  return {
    academicArchiveOpen,
    academicProfile,
    clearProfileConfirmOpen,
    clearUserProfile,
    closeAcademicArchive,
    closeClearProfileConfirm,
    openAcademicArchive,
    openClearProfileConfirm,
    profileClearMessage,
    profileSamplingEnabled,
    toggleProfileSampling,
    updateAcademicProfile
  };
}
