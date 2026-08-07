import type { AccountMembershipTier, AccountSession } from "./account.types";

const legacyAccountSessionStorageKey = "liteasy.account.session.v1";
const suppressLoginReminderStorageKey = "liteasy.account.suppress-login-reminder.v1";
let inMemoryAccountSession: AccountSession | null = null;

function removeLegacyBrowserSession() {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(legacyAccountSessionStorageKey);
}

export function loadStoredAccountSession() {
  removeLegacyBrowserSession();
  return inMemoryAccountSession;
}

export function storeAccountSession(session: AccountSession) {
  removeLegacyBrowserSession();
  const membershipTier: AccountMembershipTier =
    session.membershipTier === "pro" ? "pro" : "basic";
  inMemoryAccountSession = { ...session, membershipTier };
  return inMemoryAccountSession;
}

export function clearStoredAccountSession() {
  inMemoryAccountSession = null;
  removeLegacyBrowserSession();
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
