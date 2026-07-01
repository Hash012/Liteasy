type UseCloudAccountActionsInput = {
  applyLocalDevCloudDefaults: () => void;
  clearOrganizationNotifications: () => void;
  loginToCloudAccount: () => Promise<void> | void;
  logoutFromCloudAccount: () => void;
  resetOrganizationActions: () => void;
  resetOrganizationSelection: () => void;
};

export function useCloudAccountActions({
  applyLocalDevCloudDefaults,
  clearOrganizationNotifications,
  loginToCloudAccount,
  logoutFromCloudAccount,
  resetOrganizationActions,
  resetOrganizationSelection
}: UseCloudAccountActionsInput) {
  async function loginWithLocalDevCloudDefaults() {
    applyLocalDevCloudDefaults();
    await loginToCloudAccount();
  }

  function logoutAndClearOrganizationState() {
    logoutFromCloudAccount();
    clearOrganizationNotifications();
    resetOrganizationActions();
    resetOrganizationSelection();
  }

  return {
    loginWithLocalDevCloudDefaults,
    logoutAndClearOrganizationState
  };
}
