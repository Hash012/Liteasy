import type { AccountMembershipTier, AccountSession } from "./account.types";

const legacyAccountSessionStorageKey = "liteasy.account.session.v1";
const suppressLoginReminderStorageKey = "liteasy.account.suppress-login-reminder.v1";
const runtimeEpoch = globalThis.crypto.randomUUID?.() ??
  Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4))).join("-");
let accountSessionGeneration = 0;

export function getAccountSessionGeneration() {
  return `${runtimeEpoch}:${accountSessionGeneration}`;
}

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
  if (!inMemoryAccountSession || ["sessionId", "endpoint", "issuer", "userId"].some((key) =>
    inMemoryAccountSession?.[key as keyof AccountSession] !== session[key as keyof AccountSession])) {
    accountSessionGeneration += 1;
  }
  inMemoryAccountSession = { ...session, membershipTier };
  return inMemoryAccountSession;
}

export function clearStoredAccountSession() {
  accountSessionGeneration += 1;
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
