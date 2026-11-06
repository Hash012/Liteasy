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
const currentSessionTokens = new Set<string>();

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
    currentSessionTokens.clear();
  }
  inMemoryAccountSession = { ...session, membershipTier };
  currentSessionTokens.add(session.sessionId);
  return inMemoryAccountSession;
}

/** Rotate credentials within the same verified login, without invalidating its work. */
export function replaceRefreshedAccountSession(session: AccountSession, generation: string) {
  if (generation !== getAccountSessionGeneration() || !inMemoryAccountSession ||
    !session.userId || !session.issuer || !session.endpoint ||
    ["endpoint", "issuer", "userId"].some((key) =>
      inMemoryAccountSession?.[key as keyof AccountSession] !== session[key as keyof AccountSession])) {
    throw new Error("oauth_session_changed");
  }
  inMemoryAccountSession = { ...inMemoryAccountSession, ...session };
  // Bound aliases retained for requests whose token was captured before renewal.
  currentSessionTokens.add(session.sessionId);
  if (currentSessionTokens.size > 32) currentSessionTokens.delete(currentSessionTokens.values().next().value!);
  return inMemoryAccountSession;
}

export function isCurrentAccountSessionToken(token: string) {
  return currentSessionTokens.has(token);
}

export function clearStoredAccountSession() {
  accountSessionGeneration += 1;
  inMemoryAccountSession = null;
  currentSessionTokens.clear();
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
