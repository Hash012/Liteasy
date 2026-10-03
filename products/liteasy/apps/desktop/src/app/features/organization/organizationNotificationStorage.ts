const storagePrefix = "liteasy.organization.notifications.read.v2";

function isReadNotificationKey(value: unknown): value is string {
  return typeof value === "string" && /^[^:]+:[^:]+$/.test(value);
}

export function loadStoredOrganizationReadNotificationKeys(actorKey?: string) {
  if (!actorKey || typeof window === "undefined" || !window.localStorage) return [];
  const rawValue = window.localStorage.getItem(`${storagePrefix}:${actorKey}`);
  if (!rawValue) return [];
  try {
    const payload = JSON.parse(rawValue) as unknown;
    return Array.isArray(payload) ? [...new Set(payload.filter(isReadNotificationKey))] : [];
  } catch {
    return [];
  }
}

export function storeOrganizationReadNotificationKeys(keys: string[], actorKey?: string) {
  if (!actorKey || typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(`${storagePrefix}:${actorKey}`, JSON.stringify([...new Set(keys.filter(isReadNotificationKey))]));
}

export function clearStoredOrganizationReadNotificationKeys(actorKey?: string) {
  if (!actorKey || typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(`${storagePrefix}:${actorKey}`);
}
