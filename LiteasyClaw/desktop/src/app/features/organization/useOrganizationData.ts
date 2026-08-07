import type { AccountSession } from "../account/account.types";
import type { OrganizationListTransport } from "./organizationListClient";
import type { OrganizationSummaryTransport } from "./organizationSummaryClient";
import { useOrganizationList } from "./useOrganizationList";
import { useOrganizationSummary } from "./useOrganizationSummary";

type UseOrganizationDataInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  getActiveOrganizationId: (fallbackOrganizationId?: string) => string | undefined;
  organizationListTransport?: OrganizationListTransport;
  organizationTransport?: OrganizationSummaryTransport;
  refreshRevision?: number;
};

export function useOrganizationData({
  accountSession,
  controlPlaneEndpoint,
  getActiveOrganizationId,
  organizationListTransport,
  organizationTransport,
  refreshRevision = 0
}: UseOrganizationDataInput) {
  const {
    list: organizationList,
    message: organizationListMessage,
    status: organizationListStatus
  } = useOrganizationList({
    accountSession,
    controlPlaneEndpoint,
    refreshRevision,
    transport: organizationListTransport
  });
  const activeOrganizationId = getActiveOrganizationId(organizationList?.activeOrganizationId);
  const {
    message: organizationSummaryMessage,
    status: organizationSummaryStatus,
    summary: organizationSummary
  } = useOrganizationSummary({
    accountSession,
    controlPlaneEndpoint,
    organizationId: activeOrganizationId,
    refreshRevision,
    transport: organizationTransport
  });
  return {
    activeOrganizationId,
    organizationList,
    organizationListMessage,
    organizationListStatus,
    organizationSummary,
    organizationSummaryMessage,
    organizationSummaryStatus
  };
}
