import type { AccountMembershipTier, AccountSession } from "./account.types";

const accountSessionStorageKey = "liteasy.account.session.v1";
const suppressLoginReminderStorageKey = "liteasy.account.suppress-login-reminder.v1";

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

    const membershipTier: AccountMembershipTier =
      payload.membershipTier === "basic" ? "basic" : "pro";

    return {
      ...payload,
      membershipTier
    };
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

export function loadSuppressLoginReminderPreference() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  return window.localStorage.getItem(suppressLoginReminderStorageKey) === "true";
}

export function storeSuppressLoginReminderPreference(suppressed: boolean) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(suppressLoginReminderStorageKey, String(suppressed));
}
