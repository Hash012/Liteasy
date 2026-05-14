import { useEffect, useState } from "react";
import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import type { AccountSession } from "../account/account.types";
import {
  createOrganizationGovernanceClient,
  type OrganizationGovernanceTransport
} from "./organizationGovernanceClient";
import type {
  OrganizationGovernanceStatus,
  OrganizationGovernanceSummary,
  OrganizationSummary
} from "./organization.types";

type UseOrganizationGovernanceInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  organizationSummary: OrganizationSummary | null;
  transport?: OrganizationGovernanceTransport;
};

export function useOrganizationGovernance({
  accountSession,
  controlPlaneEndpoint,
  organizationSummary,
  transport
}: UseOrganizationGovernanceInput) {
  const [message, setMessage] = useState("连接云账号后会加载组织治理摘要。");
  const [status, setStatus] = useState<OrganizationGovernanceStatus>("unauthenticated");
  const [summary, setSummary] = useState<OrganizationGovernanceSummary | null>(null);

  useEffect(() => {
    if (!accountSession || !organizationSummary) {
      setMessage("连接云账号后会加载组织治理摘要。");
      setStatus("unauthenticated");
      setSummary(null);
      return;
    }

    let active = true;
    setMessage("正在加载组织治理摘要...");
    setStatus("loading");
    setSummary(null);

    const client = createOrganizationGovernanceClient({
      endpoint: controlPlaneEndpoint,
      transport
    });

    void client({
      organizationId: organizationSummary.organizationId,
      sessionId: accountSession.sessionId
    })
      .then((nextSummary) => {
        if (!active) {
          return;
        }

        setMessage("组织治理摘要已加载。");
        setStatus("success");
        setSummary(nextSummary);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const detail = formatCloudConnectionError(error);
        setMessage(`组织治理摘要加载失败。详细信息：${detail}`);
        setStatus("error");
        setSummary(null);
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, organizationSummary?.organizationId, transport]);

  return {
    message,
    status,
    summary
  };
}
