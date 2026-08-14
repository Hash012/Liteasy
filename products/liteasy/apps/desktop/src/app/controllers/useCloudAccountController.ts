import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountLoginInput,
  AccountRegistrationInput,
  AccountTransport
} from "../features/account/accountSessionClient";
import { useAccountSession } from "../features/account/useAccountSession";
import type { AccountSession } from "../features/account/account.types";
import { useCloudAvailabilityProbe } from "../features/network/useCloudAvailabilityProbe";
import type { SettingsState } from "../features/settings/settings.types";
import { getCloudAvailabilityStatus, type CloudAvailabilityStatus } from "../features/network/cloudAvailability";
import type {
  AccountCapabilitiesTransport,
  MultimodalVisualizationCapability
} from "../features/account/accountCapabilitiesClient";
import { useAccountCapabilities } from "../features/account/useAccountCapabilities";
import {
  createVisualizationOrchestrationClient,
  type VisualizationOrchestrationClient
} from "../features/visualization/visualizationOrchestrationClient";
import { configureRasterAssetClient } from "../features/visualization/rasterAssetClient";

type UseCloudAccountControllerInput = {
  accountCapabilitiesTransport?: AccountCapabilitiesTransport;
  accountTransport?: AccountTransport;
  applyLocalDevCloudDefaults: () => void;
  getSettings: () => SettingsState;
  isOnline: boolean;
  onRegistered?: () => void;
  visualizationFetch?: typeof fetch;
  visualizationStorage?: Storage;
};

type CloudAccountModel = {
  accountMessage?: string;
  accountPending: boolean;
  accountSession: AccountSession | null;
  cloudAvailabilityStatus: CloudAvailabilityStatus;
  developerDiagnostics: boolean;
  multimodalVisualization: MultimodalVisualizationCapability;
  loginDialogOpen: boolean;
  controlPlaneEndpoint: string;
};

type CloudAccountActions = {
  cancelVisualizationGeneration: VisualizationOrchestrationClient["cancel"];
  generateVisualization: VisualizationOrchestrationClient["startAndWait"];
  logoutFromCloudAccount: () => void;
  openLoginDialog: () => void;
  refreshAccountSession: () => Promise<AccountSession | null>;
  setMultimodalVisualizationCapability: (value: unknown) => void;
  setSuppressLoginReminder: (checked: boolean) => void;
  skipLogin: () => void;
  submitSystemBrowserLogin: () => Promise<void>;
  submitAccountLogin: (login: AccountLoginInput) => Promise<void>;
  submitAccountRegistration: (registration: AccountRegistrationInput) => Promise<void>;
  pendingVisualizationRequests: VisualizationOrchestrationClient["pending"];
  resumeVisualizationGeneration: VisualizationOrchestrationClient["resumeAndWait"];
};

export function useCloudAccountController({
  accountCapabilitiesTransport,
  accountTransport,
  applyLocalDevCloudDefaults,
  getSettings,
  isOnline,
  onRegistered,
  visualizationFetch,
  visualizationStorage
}: UseCloudAccountControllerInput): {
  actions: CloudAccountActions;
  model: CloudAccountModel;
} {
  const [loginDialogDismissedThisSession, setLoginDialogDismissedThisSession] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const {
    accountMessage,
    accountPending,
    accountSession,
    loginPersonalAccount,
    loginPersonalAccountWithSystemBrowser,
    logoutFromCloudAccount,
    refreshAccountSession,
    registerPersonalAccount,
    setSuppressLoginReminder,
    shouldShowLoginReminder
  } = useAccountSession({
    accountTransport,
    getSettings
  });
  const { isCloudReachable } = useCloudAvailabilityProbe({
    enabled: isOnline && accountSession !== null,
    endpoint: getSettings()["models.control_plane_endpoint"]
  });
  const cloudAvailabilityStatus = getCloudAvailabilityStatus({
    accountSession,
    isCloudReachable,
    isOnline
  });
  const accountCapabilities = useAccountCapabilities({
    accountSession,
    endpoint: getSettings()["models.control_plane_endpoint"],
    refreshSession: refreshAccountSession,
    transport: accountCapabilitiesTransport
  });
  const multimodalVisualizationRef = useRef(accountCapabilities.multimodalVisualization);
  multimodalVisualizationRef.current = accountCapabilities.multimodalVisualization;
  const controlPlaneEndpoint = getSettings()["models.control_plane_endpoint"];
  const visualizationClient = useMemo(() => {
    if (!accountSession) return null;
    return createVisualizationOrchestrationClient({
      endpoint: controlPlaneEndpoint,
      fetchImpl: visualizationFetch,
      getAccessToken: () => accountSession.sessionId,
      getCapability: () => multimodalVisualizationRef.current,
      refreshAccessToken: async () => (await refreshAccountSession())?.sessionId,
      storage: visualizationStorage,
      subjectId: accountSession.userId ?? accountSession.email
    });
  }, [accountSession?.email, accountSession?.sessionId, accountSession?.userId, controlPlaneEndpoint, visualizationFetch, visualizationStorage]);

  useEffect(() => {
    configureRasterAssetClient(accountSession ? {
      endpoint: controlPlaneEndpoint,
      fetchImpl: visualizationFetch,
      getAccessToken: () => accountSession.sessionId
    } : null);
    return () => configureRasterAssetClient(null);
  }, [accountSession?.sessionId, controlPlaneEndpoint, visualizationFetch]);

  useEffect(() => {
    if (
      accountSession === null &&
      accountPending === false &&
      shouldShowLoginReminder &&
      loginDialogDismissedThisSession === false
    ) {
      setLoginDialogOpen(true);
    }
  }, [accountPending, accountSession, loginDialogDismissedThisSession, shouldShowLoginReminder]);

  useEffect(() => {
    if (accountSession !== null) {
      setLoginDialogDismissedThisSession(false);
    }
  }, [accountSession]);

  async function submitAccountRegistration(registration: AccountRegistrationInput) {
    applyLocalDevCloudDefaults();
    const session = await registerPersonalAccount(registration);
    if (session) {
      setLoginDialogDismissedThisSession(true);
      setLoginDialogOpen(false);
      onRegistered?.();
    }
  }

  async function submitAccountLogin(login: AccountLoginInput) {
    applyLocalDevCloudDefaults();
    const session = await loginPersonalAccount(login);
    if (session) {
      setLoginDialogDismissedThisSession(true);
      setLoginDialogOpen(false);
    }
  }

  async function submitSystemBrowserLogin() {
    const session = await loginPersonalAccountWithSystemBrowser();
    if (session) {
      setLoginDialogDismissedThisSession(true);
      setLoginDialogOpen(false);
    }
  }

  function skipLogin() {
    setLoginDialogDismissedThisSession(true);
    setLoginDialogOpen(false);
  }

  return {
    actions: {
      cancelVisualizationGeneration: async (input) => visualizationClient?.cancel(input),
      generateVisualization: async (request) => {
        if (!visualizationClient) throw new Error("visualization_account_session_required");
        return visualizationClient.startAndWait(request);
      },
      logoutFromCloudAccount,
      openLoginDialog: () => {
        setLoginDialogDismissedThisSession(false);
        setLoginDialogOpen(true);
      },
      pendingVisualizationRequests: () => visualizationClient?.pending() ?? [],
      refreshAccountSession,
      resumeVisualizationGeneration: async (request, signal) => {
        if (!visualizationClient) throw new Error("visualization_account_session_required");
        return visualizationClient.resumeAndWait(request, signal);
      },
      setMultimodalVisualizationCapability: accountCapabilities.setMultimodalVisualizationCapability,
      setSuppressLoginReminder,
      skipLogin,
      submitAccountLogin,
      submitAccountRegistration,
      submitSystemBrowserLogin
    },
    model: {
      accountMessage,
      accountPending,
      accountSession,
      cloudAvailabilityStatus,
      controlPlaneEndpoint,
      developerDiagnostics: accountCapabilities.developerDiagnostics,
      multimodalVisualization: accountCapabilities.multimodalVisualization,
      loginDialogOpen
    }
  };
}
