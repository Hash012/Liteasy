import { useEffect, useState } from "react";
import type { AccountRegistrationInput, AccountTransport } from "../features/account/accountSessionClient";
import { useAccountSession } from "../features/account/useAccountSession";
import type { AccountSession } from "../features/account/account.types";
import { useCloudAvailabilityProbe } from "../features/network/useCloudAvailabilityProbe";
import type { SettingsState } from "../features/settings/settings.types";
import { getCloudAvailabilityStatus, type CloudAvailabilityStatus } from "../features/network/cloudAvailability";

type UseCloudAccountControllerInput = {
  accountTransport?: AccountTransport;
  applyLocalDevCloudDefaults: () => void;
  getSettings: () => SettingsState;
  isOnline: boolean;
};

type CloudAccountModel = {
  accountMessage?: string;
  accountPending: boolean;
  accountSession: AccountSession | null;
  cloudAvailabilityStatus: CloudAvailabilityStatus;
  loginDialogOpen: boolean;
};

type CloudAccountActions = {
  logoutFromCloudAccount: () => void;
  openLoginDialog: () => void;
  setSuppressLoginReminder: (checked: boolean) => void;
  skipLogin: () => void;
  submitAccountRegistration: (registration: AccountRegistrationInput) => Promise<void>;
  submitDemoLogin: () => Promise<void>;
};

export function useCloudAccountController({
  accountTransport,
  applyLocalDevCloudDefaults,
  getSettings,
  isOnline
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
    loginToCloudAccount,
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

  async function submitDemoLogin() {
    setLoginDialogDismissedThisSession(true);
    setLoginDialogOpen(false);
    applyLocalDevCloudDefaults();
    await loginToCloudAccount();
  }

  async function submitAccountRegistration(registration: AccountRegistrationInput) {
    setLoginDialogDismissedThisSession(true);
    setLoginDialogOpen(false);
    applyLocalDevCloudDefaults();
    await registerPersonalAccount(registration);
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
      setSuppressLoginReminder,
      skipLogin,
      submitAccountRegistration,
      submitDemoLogin
    },
    model: {
      accountMessage,
      accountPending,
      accountSession,
      cloudAvailabilityStatus,
      loginDialogOpen
    }
  };
}
