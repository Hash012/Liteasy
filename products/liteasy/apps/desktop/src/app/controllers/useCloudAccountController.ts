import { useEffect, useState } from "react";
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

type UseCloudAccountControllerInput = {
  accountCapabilitiesTransport?: AccountCapabilitiesTransport;
  accountTransport?: AccountTransport;
  applyLocalDevCloudDefaults: () => void;
  getSettings: () => SettingsState;
  isOnline: boolean;
  onRegistered?: () => void;
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
  logoutFromCloudAccount: () => void;
  openLoginDialog: () => void;
  setMultimodalVisualizationCapability: (value: unknown) => void;
  setSuppressLoginReminder: (checked: boolean) => void;
  skipLogin: () => void;
  submitSystemBrowserLogin: () => Promise<void>;
  submitAccountLogin: (login: AccountLoginInput) => Promise<void>;
  submitAccountRegistration: (registration: AccountRegistrationInput) => Promise<void>;
};

export function useCloudAccountController({
  accountCapabilitiesTransport,
  accountTransport,
  applyLocalDevCloudDefaults,
  getSettings,
  isOnline,
  onRegistered
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
    registerPersonalAccount,
    setSuppressLoginReminder,
    shouldShowLoginReminder
  } = useAccountSession({
    accountTransport,
    getSettings,
    onSessionRestored: applyLocalDevCloudDefaults
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
    transport: accountCapabilitiesTransport
  });

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
      logoutFromCloudAccount,
      openLoginDialog: () => {
        setLoginDialogDismissedThisSession(false);
        setLoginDialogOpen(true);
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
      controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"],
      developerDiagnostics: accountCapabilities.developerDiagnostics,
      multimodalVisualization: accountCapabilities.multimodalVisualization,
      loginDialogOpen
    }
  };
}
