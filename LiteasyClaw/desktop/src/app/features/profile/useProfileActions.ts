import { useState } from "react";
import type { AcademicProfile } from "./profile.types";
import { defaultAcademicProfile } from "./profile.types";
import {
  clearAcademicProfile,
  loadAcademicProfile,
  saveAcademicProfile
} from "./profileStorage";
import {
  loadAgentPersonalization,
  saveAgentPersonalization,
  type AgentPersonalization
} from "../agent-core/agentPersonalization";

type UseProfileActionsInput = {
  onProfileSamplingChanged?: (enabled: boolean) => void;
  profileSamplingEnabled?: boolean;
};

export function useProfileActions({
  onProfileSamplingChanged,
  profileSamplingEnabled = false
}: UseProfileActionsInput = {}) {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [academicProfile, setAcademicProfile] = useState<AcademicProfile>(loadAcademicProfile);
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [profileClearMessage, setProfileClearMessage] = useState<string | undefined>();
  const [agentPersonalization, setAgentPersonalization] = useState<AgentPersonalization>(
    loadAgentPersonalization
  );

  function updateAgentMemories(memories: AgentPersonalization["memories"]) {
    setAgentPersonalization((current) => {
      const next = { ...current, memories: memories.map((memory) => ({ ...memory })) };
      saveAgentPersonalization(next);
      return next;
    });
  }

  function updateAgentRecentStateOverride(recentStateOverride: string) {
    setAgentPersonalization((current) => {
      const next = { ...current, recentStateOverride: recentStateOverride.slice(0, 1200) };
      saveAgentPersonalization(next);
      return next;
    });
  }

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
    saveAcademicProfile(nextProfile);
    setProfileClearMessage("画像配置已更新。");
  }

  function clearUserProfile() {
    setAcademicProfile({ ...defaultAcademicProfile });
    clearAcademicProfile();
    setClearProfileConfirmOpen(false);
    setProfileClearMessage("用户画像已清空，基础身份信息已保留。");
    onProfileSamplingChanged?.(false);
  }

  return {
    academicArchiveOpen,
    academicProfile,
    agentMemories: agentPersonalization.memories,
    agentRecentStateOverride: agentPersonalization.recentStateOverride,
    clearProfileConfirmOpen,
    clearUserProfile,
    closeAcademicArchive,
    closeClearProfileConfirm,
    openAcademicArchive,
    openClearProfileConfirm,
    profileClearMessage,
    profileSamplingEnabled,
    toggleProfileSampling,
    updateAgentMemories,
    updateAgentRecentStateOverride,
    updateAcademicProfile
  };
}
