import { useEffect, useMemo, useState } from "react";
import type { AccountSession } from "../account/account.types";
import {
  buildAcademicProfileAssistantSummary,
  defaultAcademicProfile,
  type AcademicProfile
} from "./profile.types";
import {
  createAcademicProfileClient,
  type AcademicProfileTransport,
  type PersonalizationSignal
} from "./academicProfileClient";
import {
  clearAcademicProfile,
  loadAcademicProfile,
  saveAcademicProfile
} from "./profileStorage";

type UseProfileActionsInput = {
  accountSession?: AccountSession | null;
  controlPlaneEndpoint?: string;
  transport?: AcademicProfileTransport;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function toAcademicProfile(profile: Partial<AcademicProfile>): AcademicProfile {
  return {
    ...defaultAcademicProfile,
    ...profile,
    disciplines: Array.isArray(profile.disciplines) ? profile.disciplines : []
  };
}

export function useProfileActions({
  accountSession = null,
  controlPlaneEndpoint = "mock://control-plane",
  transport
}: UseProfileActionsInput = {}) {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [academicProfile, setAcademicProfile] = useState<AcademicProfile>(loadAcademicProfile);
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [profileClearMessage, setProfileClearMessage] = useState<string | undefined>();
  const [personalizationSummary, setPersonalizationSummary] = useState<string | undefined>();
  const [personalizationVersion, setPersonalizationVersion] = useState(0);
  const client = useMemo(
    () =>
      accountSession && !isMockEndpoint(controlPlaneEndpoint)
        ? createAcademicProfileClient({ endpoint: controlPlaneEndpoint, transport })
        : null,
    [accountSession?.sessionId, controlPlaneEndpoint, transport]
  );

  useEffect(() => {
    if (!accountSession || !client) {
      setPersonalizationSummary(undefined);
      setPersonalizationVersion(0);
      return;
    }

    let active = true;
    void client
      .get(accountSession)
      .then((snapshot) => {
        if (!active) {
          return;
        }
        const nextProfile = toAcademicProfile(snapshot.profile);
        setAcademicProfile(nextProfile);
        saveAcademicProfile(nextProfile);
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
      })
      .catch(() => {
        if (active) {
          setProfileClearMessage("学术档案暂未同步，将在网络恢复后继续保存。");
        }
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, client]);

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

  function updateAcademicProfile(nextProfile: AcademicProfile) {
    setAcademicProfile(nextProfile);
    saveAcademicProfile(nextProfile);
    if (!accountSession || !client) {
      setProfileClearMessage("学术档案已更新。");
      return;
    }

    return client
      .save(accountSession, nextProfile)
      .then((snapshot) => {
        const savedProfile = toAcademicProfile({ ...nextProfile, ...snapshot.profile });
        setAcademicProfile(savedProfile);
        saveAcademicProfile(savedProfile);
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
        setProfileClearMessage("学术档案已保存。");
      })
      .catch(() => {
        setProfileClearMessage("学术档案已保存在本机；云端同步失败，请稍后重试。");
      });
  }

  function markProfileExported() {
    setProfileClearMessage("学术档案已导出。");
  }

  function clearUserProfile() {
    const clearedProfile = { ...defaultAcademicProfile };
    setAcademicProfile(clearedProfile);
    clearAcademicProfile();
    setPersonalizationSummary(undefined);
    setPersonalizationVersion(0);
    setClearProfileConfirmOpen(false);

    if (!accountSession || !client) {
      setProfileClearMessage("学术档案已清空。");
      return;
    }

    return client
      .clear(accountSession)
      .then((snapshot) => {
        const nextProfile = toAcademicProfile(snapshot.profile);
        setAcademicProfile(nextProfile);
        saveAcademicProfile(nextProfile);
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
        setProfileClearMessage("学术档案已清空，并已同步到云端。");
      })
      .catch(() => {
        setProfileClearMessage("学术档案已在本机清空；云端同步失败，请稍后重试。");
      });
  }

  function recordPersonalizationSignal(signal: PersonalizationSignal) {
    if (!accountSession || !client) {
      return;
    }

    return client
      .recordSignal(accountSession, signal)
      .then((snapshot) => {
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
      })
      .catch(() => {
        // Personalization updates must never interrupt the primary reading workflow.
      });
  }

  return {
    academicArchiveOpen,
    academicProfile,
    assistantProfileSummary: [
      buildAcademicProfileAssistantSummary(academicProfile),
      personalizationSummary
    ]
      .filter((value): value is string => Boolean(value))
      .join("；") || undefined,
    clearProfileConfirmOpen,
    clearUserProfile,
    closeAcademicArchive,
    closeClearProfileConfirm,
    markProfileExported,
    openAcademicArchive,
    openClearProfileConfirm,
    personalizationVersion,
    profileClearMessage,
    recordPersonalizationSignal,
    updateAcademicProfile
  };
}
