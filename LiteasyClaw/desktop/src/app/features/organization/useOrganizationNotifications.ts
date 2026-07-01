import { useState } from "react";
import type { OrganizationSummary } from "./organization.types";
import {
  clearStoredOrganizationReadNotificationKeys,
  loadStoredOrganizationReadNotificationKeys,
  storeOrganizationReadNotificationKeys
} from "./organizationNotificationStorage";

type UseOrganizationNotificationsOptions = {
  onAnalysisHint: (message: string) => void;
};

export function getOrganizationNotificationReadKey(organizationId: string, notificationId: string) {
  return `${organizationId}:${notificationId}`;
}

export function useOrganizationNotifications({ onAnalysisHint }: UseOrganizationNotificationsOptions) {
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() =>
    loadStoredOrganizationReadNotificationKeys()
  );

  function markOrganizationNotificationsRead(summary: OrganizationSummary) {
    setReadNotificationIds((currentIds) => {
      const nextIds = [
        ...new Set([
          ...currentIds,
          ...summary.notifications.map((notification) =>
            getOrganizationNotificationReadKey(summary.organizationId, notification.id)
          )
        ])
      ];
      storeOrganizationReadNotificationKeys(nextIds);
      return nextIds;
    });
    onAnalysisHint("组织通知已全部标记为已读。");
  }

  function clearOrganizationNotifications() {
    setReadNotificationIds([]);
    clearStoredOrganizationReadNotificationKeys();
  }

  return {
    clearOrganizationNotifications,
    markOrganizationNotificationsRead,
    readNotificationIds
  };
}
