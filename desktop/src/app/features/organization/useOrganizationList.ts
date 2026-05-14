import { useEffect, useState } from "react";
import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import type { AccountSession } from "../account/account.types";
import {
  createOrganizationListClient,
  type OrganizationListTransport
} from "./organizationListClient";
import type { OrganizationList, OrganizationListStatus } from "./organization.types";

type UseOrganizationListInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  transport?: OrganizationListTransport;
};

export function useOrganizationList({
  accountSession,
  controlPlaneEndpoint,
  transport
}: UseOrganizationListInput) {
  const [list, setList] = useState<OrganizationList | null>(null);
  const [message, setMessage] = useState("连接云账号后会加载组织列表。");
  const [status, setStatus] = useState<OrganizationListStatus>("unauthenticated");

  useEffect(() => {
    if (!accountSession) {
      setList(null);
      setMessage("连接云账号后会加载组织列表。");
      setStatus("unauthenticated");
      return;
    }

    let active = true;
    setList(null);
    setMessage("正在加载组织列表...");
    setStatus("loading");

    const client = createOrganizationListClient({
      endpoint: controlPlaneEndpoint,
      transport
    });

    void client({ sessionId: accountSession.sessionId })
      .then((nextList) => {
        if (!active) {
          return;
        }

        setList(nextList);
        setMessage("组织列表已加载。");
        setStatus("success");
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const detail = formatCloudConnectionError(error);
        setList(null);
        setMessage(`组织列表加载失败。详细信息：${detail}`);
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, transport]);

  return {
    list,
    message,
    status
  };
}
