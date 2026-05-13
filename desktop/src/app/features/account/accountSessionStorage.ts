import type { AccountSession } from "./account.types";

const accountSessionStorageKey = "liteasy.account.session.v1";

export function loadStoredAccountSession() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  const rawValue = window.localStorage.getItem(accountSessionStorageKey);
  if (!rawValue) {
    return null;
  }

  try {
    const payload = JSON.parse(rawValue) as AccountSession;
    if (
      typeof payload.email !== "string" ||
      typeof payload.expiresAt !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.sessionId !== "string"
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function storeAccountSession(session: AccountSession) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(accountSessionStorageKey, JSON.stringify(session));
}

export function clearStoredAccountSession() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.removeItem(accountSessionStorageKey);
}
