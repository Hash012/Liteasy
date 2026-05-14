import { useEffect, useState } from "react";
import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import type { AccountSession } from "../account/account.types";
import {
  createOrganizationSummaryClient,
  type OrganizationSummaryTransport
} from "./organizationSummaryClient";
import type { OrganizationSummary, OrganizationSummaryStatus } from "./organization.types";

type UseOrganizationSummaryInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  organizationId?: string;
  transport?: OrganizationSummaryTransport;
};

export function useOrganizationSummary({
  accountSession,
  controlPlaneEndpoint,
  organizationId,
  transport
}: UseOrganizationSummaryInput) {
  const [message, setMessage] = useState("连接云账号后会加载组织空间。");
  const [status, setStatus] = useState<OrganizationSummaryStatus>("unauthenticated");
  const [summary, setSummary] = useState<OrganizationSummary | null>(null);

  useEffect(() => {
    if (!accountSession) {
      setMessage("连接云账号后会加载组织空间。");
      setStatus("unauthenticated");
      setSummary(null);
      return;
    }

    let active = true;
    setMessage("正在加载组织空间...");
    setStatus("loading");
    setSummary(null);

    const client = createOrganizationSummaryClient({
      endpoint: controlPlaneEndpoint,
      transport
    });

    void client({ organizationId, sessionId: accountSession.sessionId })
      .then((nextSummary) => {
        if (!active) {
          return;
        }

        setMessage("组织空间已加载。");
        setStatus("success");
        setSummary(nextSummary);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const detail = formatCloudConnectionError(error);
        setMessage(`组织空间加载失败。详细信息：${detail}`);
        setStatus("error");
        setSummary(null);
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, organizationId, transport]);

  return {
    message,
    status,
    summary
  };
}
