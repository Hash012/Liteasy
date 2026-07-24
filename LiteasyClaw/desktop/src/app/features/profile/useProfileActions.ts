import { useEffect, useMemo, useState } from "react";
import type { AccountSession } from "../account/account.types";
import type { AcademicProfile } from "./profile.types";
import { buildAcademicProfileAssistantSummary, defaultAcademicProfile } from "./profile.types";
import {
  createAcademicProfileClient,
  type AcademicProfileTransport,
  type PersonalizationSignal
} from "./academicProfileClient";

type UseProfileActionsInput = {
  accountSession?: AccountSession | null;
  controlPlaneEndpoint?: string;
  transport?: AcademicProfileTransport;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function toAcademicProfile(profile: AcademicProfile) {
  return {
    disciplines: profile.disciplines,
    stage: profile.stage
  } satisfies AcademicProfile;
}

export function useProfileActions({
  accountSession = null,
  controlPlaneEndpoint = "mock://control-plane",
  transport
}: UseProfileActionsInput = {}) {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [academicProfile, setAcademicProfile] = useState<AcademicProfile>(defaultAcademicProfile);
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
      setAcademicProfile(defaultAcademicProfile);
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
        setAcademicProfile(toAcademicProfile(snapshot.profile));
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
    if (!accountSession || !client) {
      setAcademicProfile(nextProfile);
      setProfileClearMessage("学术档案已更新。");
      return;
    }

    return client
      .save(accountSession, nextProfile)
      .then((snapshot) => {
        setAcademicProfile(toAcademicProfile(snapshot.profile));
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
        setProfileClearMessage("学术档案已保存。");
      })
      .catch(() => {
        setProfileClearMessage("学术档案保存失败，请检查云端连接后重试。");
      });
  }

  function markProfileExported() {
    setProfileClearMessage("学术档案已导出。");
  }

  function clearUserProfile() {
    if (!accountSession || !client) {
      setAcademicProfile(defaultAcademicProfile);
      setPersonalizationSummary(undefined);
      setPersonalizationVersion(0);
      setClearProfileConfirmOpen(false);
      setProfileClearMessage("已清空学科、补充说明和研究阶段。");
      return;
    }

    return client
      .clear(accountSession)
      .then((snapshot) => {
        setAcademicProfile(toAcademicProfile(snapshot.profile));
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
        setClearProfileConfirmOpen(false);
        setProfileClearMessage("已清空学术档案，并重置个性化调整。");
      })
      .catch(() => {
        setProfileClearMessage("学术档案清空失败，请检查云端连接后重试。");
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
        // 个性化更新不能影响阅读、收藏或问答等主流程。
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
    openAcademicArchive,
    openClearProfileConfirm,
    markProfileExported,
    profileClearMessage,
    personalizationVersion,
    recordPersonalizationSignal,
    updateAcademicProfile
  };
}
