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
  refreshRevision?: number;
  transport?: OrganizationSummaryTransport;
};

export function useOrganizationSummary({
  accountSession,
  controlPlaneEndpoint,
  organizationId,
  refreshRevision = 0,
  transport
}: UseOrganizationSummaryInput) {
  const [message, setMessage] = useState("当前已退化为本地阅读器，组织空间不可用。联网并登录后，将自动恢复云端能力。");
  const [status, setStatus] = useState<OrganizationSummaryStatus>("unauthenticated");
  const [summary, setSummary] = useState<OrganizationSummary | null>(null);

  useEffect(() => {
    if (!accountSession) {
      setMessage("当前已退化为本地阅读器，组织空间不可用。联网并登录后，将自动恢复云端能力。");
      setStatus("unauthenticated");
      setSummary(null);
      return;
    }

    if (!organizationId) {
      setMessage("尚未加入组织。");
      setStatus("idle");
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

        const detail = formatCloudConnectionError(error, {
          controlPlaneEndpoint
        });
        setMessage(`组织空间加载失败。详细信息：${detail}`);
        setStatus("error");
        setSummary(null);
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, organizationId, refreshRevision, transport]);

  return {
    message,
    status,
    summary
  };
}
