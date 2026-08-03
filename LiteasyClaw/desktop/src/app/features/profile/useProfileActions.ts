import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSession } from "../account/account.types";
import type { AcademicProfile } from "./profile.types";
import { buildAcademicProfileAssistantSummary, defaultAcademicProfile } from "./profile.types";
import {
  createAcademicProfileClient,
  type AcademicProfileTransport,
  type PersonalizationSignal,
  type UserTag
} from "./academicProfileClient";
import {
  clearAcademicProfile,
  loadAcademicProfile,
  saveAcademicProfile
} from "./profileStorage";

type UseProfileActionsInput = {
  accountSession?: AccountSession | null;
  controlPlaneEndpoint?: string;
  onProfileSamplingChanged?: (enabled: boolean) => void;
  profileSamplingEnabled?: boolean;
  transport?: AcademicProfileTransport;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function localOnlyProfile(profile: AcademicProfile): AcademicProfile {
  return { ...profile, disciplines: [] };
}

export function useProfileActions({
  accountSession = null,
  controlPlaneEndpoint = "mock://control-plane",
  onProfileSamplingChanged,
  profileSamplingEnabled = false,
  transport
}: UseProfileActionsInput = {}) {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [academicProfile, setAcademicProfile] = useState<AcademicProfile>(() =>
    localOnlyProfile(loadAcademicProfile())
  );
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [profileClearMessage, setProfileClearMessage] = useState<string | undefined>();
  const [personalizationSummary, setPersonalizationSummary] = useState<string | undefined>();
  const [personalizationVersion, setPersonalizationVersion] = useState(0);
  const [profileTags, setProfileTags] = useState<UserTag[]>([]);
  const currentSessionIdRef = useRef(accountSession?.sessionId);
  currentSessionIdRef.current = accountSession?.sessionId;
  const client = useMemo(
    () =>
      accountSession && !isMockEndpoint(controlPlaneEndpoint)
        ? createAcademicProfileClient({ endpoint: controlPlaneEndpoint, transport })
        : null,
    [accountSession?.sessionId, controlPlaneEndpoint, transport]
  );

  useEffect(() => {
    const localProfile = localOnlyProfile(loadAcademicProfile());
    setAcademicProfile(localProfile);
    setPersonalizationSummary(undefined);
    setPersonalizationVersion(0);
    setProfileTags([]);
    setProfileClearMessage(undefined);

    if (!accountSession || !client) {
      return;
    }

    const sessionId = accountSession.sessionId;
    let active = true;
    void client
      .get(accountSession)
      .then((snapshot) => {
        if (!active || currentSessionIdRef.current !== sessionId) {
          return;
        }
        setAcademicProfile({
          ...localProfile,
          disciplines: snapshot.profile.disciplines,
          stage: snapshot.profile.stage
        });
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
        setProfileTags(snapshot.tags ?? []);
      })
      .catch(() => {
        if (active && currentSessionIdRef.current === sessionId) {
          setProfileClearMessage("云端学术档案加载失败，请检查连接后重新登录。");
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

  function toggleProfileSampling() {
    setProfileClearMessage(undefined);
    onProfileSamplingChanged?.(!profileSamplingEnabled);
  }

  async function updateAcademicProfile(nextProfile: AcademicProfile) {
    saveAcademicProfile(localOnlyProfile(nextProfile));
    if (!accountSession || !client) {
      setAcademicProfile(nextProfile);
      setProfileClearMessage("学术档案已保存到本机。");
      return;
    }

    const sessionId = accountSession.sessionId;
    try {
      const snapshot = await client.save(accountSession, {
        disciplines: nextProfile.disciplines,
        stage: nextProfile.stage
      });
      if (currentSessionIdRef.current !== sessionId) {
        return;
      }
      setAcademicProfile({
        ...nextProfile,
        disciplines: snapshot.profile.disciplines,
        stage: snapshot.profile.stage
      });
      setPersonalizationSummary(snapshot.assistantSummary);
      setPersonalizationVersion(snapshot.personalizationVersion);
      setProfileTags(snapshot.tags ?? []);
      setProfileClearMessage("学术档案已保存并同步。");
    } catch {
      if (currentSessionIdRef.current === sessionId) {
        setAcademicProfile(nextProfile);
        setProfileClearMessage("本机档案已保存，云端同步失败，请检查连接后重试。");
      }
    }
  }

  function markProfileExported() {
    setProfileClearMessage("学术档案已导出。");
  }

  async function clearUserProfile() {
    if (accountSession && client) {
      const sessionId = accountSession.sessionId;
      try {
        const snapshot = await client.clear(accountSession);
        if (currentSessionIdRef.current !== sessionId) {
          return;
        }
        clearAcademicProfile();
        setAcademicProfile({ ...defaultAcademicProfile, disciplines: [] });
        setPersonalizationSummary(snapshot.assistantSummary);
        setPersonalizationVersion(snapshot.personalizationVersion);
        setProfileTags(snapshot.tags ?? []);
        setClearProfileConfirmOpen(false);
        setProfileClearMessage("已清空学术档案和个性化数据。");
        onProfileSamplingChanged?.(false);
      } catch {
        if (currentSessionIdRef.current === sessionId) {
          setProfileClearMessage("学术档案清空失败，请检查云端连接后重试。");
        }
      }
      return;
    }

    clearAcademicProfile();
    setAcademicProfile({ ...defaultAcademicProfile, disciplines: [] });
    setPersonalizationSummary(undefined);
    setPersonalizationVersion(0);
    setProfileTags([]);
    setClearProfileConfirmOpen(false);
    setProfileClearMessage("已清空本机学术档案。");
    onProfileSamplingChanged?.(false);
  }

  async function recordPersonalizationSignal(signal: PersonalizationSignal) {
    if (!profileSamplingEnabled || !accountSession || !client) {
      return;
    }

    const sessionId = accountSession.sessionId;
    try {
      const snapshot = await client.recordSignal(accountSession, signal);
      if (currentSessionIdRef.current !== sessionId) {
        return;
      }
      setPersonalizationSummary(snapshot.assistantSummary);
      setPersonalizationVersion(snapshot.personalizationVersion);
      setProfileTags(snapshot.tags ?? []);
    } catch {
      // Personalization updates must not interrupt reading or collection workflows.
    }
  }

  return {
    academicArchiveOpen,
    academicProfile,
    assistantProfileSummary: profileSamplingEnabled
      ? [buildAcademicProfileAssistantSummary(academicProfile), personalizationSummary]
          .filter((value): value is string => Boolean(value))
          .join("；") || undefined
      : undefined,
    clearProfileConfirmOpen,
    clearUserProfile,
    closeAcademicArchive,
    closeClearProfileConfirm,
    markProfileExported,
    openAcademicArchive,
    openClearProfileConfirm,
    personalizationVersion,
    profileClearMessage,
    profileSamplingEnabled,
    profileTags,
    recordPersonalizationSignal,
    toggleProfileSampling,
    updateAcademicProfile
  };
}
