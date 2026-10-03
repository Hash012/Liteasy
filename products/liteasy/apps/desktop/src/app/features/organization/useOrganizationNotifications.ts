import { useEffect, useRef, useState } from "react";
import type { AccountSession } from "../account/account.types";
import { accountActorStorageKey } from "../account/accountSessionBinding";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";
import type { OrganizationSummary } from "./organization.types";
import {
  loadStoredOrganizationReadNotificationKeys,
  storeOrganizationReadNotificationKeys
} from "./organizationNotificationStorage";

type UseOrganizationNotificationsOptions = {
  accountSession?: AccountSession | null;
  controlPlaneEndpoint?: string;
  onAnalysisHint: (message: string) => void;
};

export function getOrganizationNotificationReadKey(organizationId: string, notificationId: string) {
  return `${organizationId}:${notificationId}`;
}

export function useOrganizationNotifications({ accountSession, controlPlaneEndpoint = "", onAnalysisHint }: UseOrganizationNotificationsOptions) {
  const actorKey = accountActorStorageKey(accountSession ?? null, controlPlaneEndpoint);
  const generation = getAccountSessionGeneration();
  const scopeKey = JSON.stringify([actorKey, controlPlaneEndpoint, accountSession?.sessionId, generation]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const [state, setState] = useState(() => ({ key: scopeKey, ids: loadStoredOrganizationReadNotificationKeys(actorKey) }));
  useEffect(() => {
    setState({ key: scopeKey, ids: loadStoredOrganizationReadNotificationKeys(actorKey) });
  }, [scopeKey, actorKey]);
  const readNotificationIds = state.key === scopeKey ? state.ids : [];

  function markOrganizationNotificationsRead(summary: OrganizationSummary) {
    if (!accountSession || currentScope.current !== scopeKey || generation !== getAccountSessionGeneration()) return;
    const nextIds = [...new Set([
      ...readNotificationIds,
      ...summary.notifications.map((notification) => getOrganizationNotificationReadKey(summary.organizationId, notification.id))
    ])];
    storeOrganizationReadNotificationKeys(nextIds, actorKey);
    setState({ key: scopeKey, ids: nextIds });
    onAnalysisHint("通知已在此设备标记为已读；邀请或任务仍需单独处理。");
  }

  function clearOrganizationNotifications() {
    // Logout clears only the current view. The original actor keeps their own read history.
    setState({ key: scopeKey, ids: [] });
  }

  return { clearOrganizationNotifications, markOrganizationNotificationsRead, readNotificationIds };
}
