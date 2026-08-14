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
import {
  loadAgentPersonalization,
  saveAgentPersonalization,
  type AgentPersonalization
} from "../agent-core/agentPersonalization";

type UseProfileActionsInput = {
  accountSession?: AccountSession | null;
  controlPlaneEndpoint?: string;
  onProfileSamplingChanged?: (enabled: boolean) => void;
  profileSamplingEnabled?: boolean;
  refreshAccountSession?: () => Promise<AccountSession | null>;
  transport?: AcademicProfileTransport;
};

function localOnlyProfile(profile: AcademicProfile): AcademicProfile {
  return { ...profile, disciplines: [] };
}

export function useProfileActions({
  accountSession = null,
  controlPlaneEndpoint = "http://127.0.0.1:8787",
  onProfileSamplingChanged,
  profileSamplingEnabled = false,
  refreshAccountSession,
  transport
}: UseProfileActionsInput = {}) {
  const [academicArchiveOpen, setAcademicArchiveOpen] = useState(false);
  const [academicProfile, setAcademicProfile] = useState<AcademicProfile>(() =>
    localOnlyProfile(loadAcademicProfile())
  );
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [profileClearMessage, setProfileClearMessage] = useState<string | undefined>();
  const [profileSamplingPending, setProfileSamplingPending] = useState(false);
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
  const [personalizationSummary, setPersonalizationSummary] = useState<string | undefined>();
  const [personalizationVersion, setPersonalizationVersion] = useState(0);
  const personalizationVersionRef = useRef(0);
  personalizationVersionRef.current = personalizationVersion;
  const [profileTags, setProfileTags] = useState<UserTag[]>([]);
  const currentSessionIdRef = useRef(accountSession?.sessionId);
  currentSessionIdRef.current = accountSession?.sessionId;
  const client = useMemo(
    () =>
      accountSession
        ? createAcademicProfileClient({
            endpoint: controlPlaneEndpoint,
            refreshSession: refreshAccountSession,
            transport
          })
        : null,
    [accountSession?.sessionId, controlPlaneEndpoint, refreshAccountSession, transport]
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
        if (
          typeof snapshot.enabled === "boolean" &&
          snapshot.enabled !== profileSamplingEnabled
        ) {
          onProfileSamplingChanged?.(snapshot.enabled);
        }
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

  async function toggleProfileSampling() {
    setProfileClearMessage(undefined);
    const enabled = !profileSamplingEnabled;
    if (!accountSession || !client) {
      onProfileSamplingChanged?.(enabled);
      return;
    }
    const sessionId = accountSession.sessionId;
    setProfileSamplingPending(true);
    try {
      const snapshot = await client.setEnabled(accountSession, enabled, personalizationVersionRef.current);
      if (currentSessionIdRef.current !== sessionId) {
        return;
      }
      setPersonalizationSummary(snapshot.assistantSummary);
      setPersonalizationVersion(snapshot.personalizationVersion);
      setProfileTags(snapshot.tags ?? []);
      onProfileSamplingChanged?.(snapshot.enabled ?? enabled);
      setProfileClearMessage(enabled ? "个性化已开启。" : "个性化已关闭，新的清单与行为信号将不再上传。");
    } catch {
      if (currentSessionIdRef.current === sessionId) {
        setProfileClearMessage("个性化设置更新失败，请检查云端连接后重试。");
      }
    } finally {
      if (currentSessionIdRef.current === sessionId) {
        setProfileSamplingPending(false);
      }
    }
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
      }, personalizationVersionRef.current);
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
        const snapshot = await client.clear(accountSession, personalizationVersionRef.current);
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
        onProfileSamplingChanged?.(snapshot.enabled ?? false);
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
    agentMemories: agentPersonalization.memories,
    agentRecentStateOverride: agentPersonalization.recentStateOverride,
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
    profileSamplingPending,
    profileTags,
    recordPersonalizationSignal,
    toggleProfileSampling,
    updateAgentMemories,
    updateAgentRecentStateOverride,
    updateAcademicProfile
  };
}
