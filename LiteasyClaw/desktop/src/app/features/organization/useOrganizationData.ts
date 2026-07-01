import type { AccountSession } from "../account/account.types";
import type { OrganizationGovernanceTransport } from "./organizationGovernanceClient";
import type { OrganizationListTransport } from "./organizationListClient";
import type { OrganizationSummaryTransport } from "./organizationSummaryClient";
import { useOrganizationGovernance } from "./useOrganizationGovernance";
import { useOrganizationList } from "./useOrganizationList";
import { useOrganizationSummary } from "./useOrganizationSummary";

type UseOrganizationDataInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  getActiveOrganizationId: (fallbackOrganizationId?: string) => string | undefined;
  organizationGovernanceTransport?: OrganizationGovernanceTransport;
  organizationListTransport?: OrganizationListTransport;
  organizationTransport?: OrganizationSummaryTransport;
};

export function useOrganizationData({
  accountSession,
  controlPlaneEndpoint,
  getActiveOrganizationId,
  organizationGovernanceTransport,
  organizationListTransport,
  organizationTransport
}: UseOrganizationDataInput) {
  const {
    list: organizationList,
    message: organizationListMessage,
    status: organizationListStatus
  } = useOrganizationList({
    accountSession,
    controlPlaneEndpoint,
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
    transport: organizationTransport
  });
  const {
    message: organizationGovernanceMessage,
    status: organizationGovernanceStatus,
    summary: organizationGovernanceSummary
  } = useOrganizationGovernance({
    accountSession,
    controlPlaneEndpoint,
    organizationSummary,
    transport: organizationGovernanceTransport
  });

  return {
    activeOrganizationId,
    organizationGovernanceMessage,
    organizationGovernanceStatus,
    organizationGovernanceSummary,
    organizationList,
    organizationListMessage,
    organizationListStatus,
    organizationSummary,
    organizationSummaryMessage,
    organizationSummaryStatus
  };
}
