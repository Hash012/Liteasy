import { useState } from "react";

export function useOrganizationUiState() {
  const [organizationDialogOpen, setOrganizationDialogOpen] = useState(false);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | undefined>();

  function closeOrganizationDialog() {
    setOrganizationDialogOpen(false);
  }

  function openOrganizationDialog() {
    setOrganizationDialogOpen(true);
  }

  function selectOrganization(organizationId: string) {
    setSelectedOrganizationId(organizationId);
  }

  function resetOrganizationSelection() {
    setSelectedOrganizationId(undefined);
  }

  function getActiveOrganizationId(fallbackOrganizationId?: string) {
    return selectedOrganizationId ?? fallbackOrganizationId;
  }

  return {
    closeOrganizationDialog,
    getActiveOrganizationId,
    openOrganizationDialog,
    organizationDialogOpen,
    resetOrganizationSelection,
    selectOrganization,
    selectedOrganizationId
  };
}
