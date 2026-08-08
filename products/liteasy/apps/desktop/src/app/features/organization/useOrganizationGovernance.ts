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
  const [message, setMessage] = useState("当前已退化为本地阅读器，组织治理摘要不可用。联网并登录后，将自动恢复云端能力。");
  const [status, setStatus] = useState<OrganizationGovernanceStatus>("unauthenticated");
  const [summary, setSummary] = useState<OrganizationGovernanceSummary | null>(null);

  useEffect(() => {
    if (!accountSession) {
      setMessage("当前已退化为本地阅读器，组织治理摘要不可用。联网并登录后，将自动恢复云端能力。");
      setStatus("unauthenticated");
      setSummary(null);
      return;
    }

    if (!organizationSummary) {
      setMessage("组织空间加载完成后会同步组织治理摘要。");
      setStatus("waiting");
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

        const detail = formatCloudConnectionError(error, {
          controlPlaneEndpoint
        });
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
