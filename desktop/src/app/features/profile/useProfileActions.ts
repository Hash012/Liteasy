import { useState } from "react";

export function useProfileActions() {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [profileClearMessage, setProfileClearMessage] = useState<string | undefined>();
  const [profileSamplingEnabled, setProfileSamplingEnabled] = useState(false);

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
    setProfileSamplingEnabled((enabled) => !enabled);
  }

  function clearUserProfile() {
    setClearProfileConfirmOpen(false);
    setProfileClearMessage("用户画像已清空，基础身份信息已保留。");
    setProfileSamplingEnabled(false);
  }

  return {
    academicArchiveOpen,
    clearProfileConfirmOpen,
    clearUserProfile,
    closeAcademicArchive,
    closeClearProfileConfirm,
    openAcademicArchive,
    openClearProfileConfirm,
    profileClearMessage,
    profileSamplingEnabled,
    toggleProfileSampling
  };
}
