const organizationNotificationReadStorageKey = "liteasy.organization.notifications.read.v1";

function isReadNotificationKey(value: unknown): value is string {
  return typeof value === "string" && /^[^:]+:[^:]+$/.test(value);
}

export function loadStoredOrganizationReadNotificationKeys() {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  const rawValue = window.localStorage.getItem(organizationNotificationReadStorageKey);
  if (!rawValue) {
    return [];
  }

  try {
    const payload = JSON.parse(rawValue) as unknown;
    return Array.isArray(payload) ? [...new Set(payload.filter(isReadNotificationKey))] : [];
  } catch {
    return [];
  }
}

export function storeOrganizationReadNotificationKeys(keys: string[]) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(
    organizationNotificationReadStorageKey,
    JSON.stringify([...new Set(keys.filter(isReadNotificationKey))])
  );
}

export function clearStoredOrganizationReadNotificationKeys() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.removeItem(organizationNotificationReadStorageKey);
}
