import { expect, test } from "vitest";
import { accountActorStorageKey, captureAccountSessionRequest } from "../app/features/account/accountSessionBinding";
import { clearStoredAccountSession, getAccountSessionGeneration, replaceRefreshedAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";

const session = { email: "same-label@example.test", name: "Same label", expiresAt: "2099-01-01T00:00:00Z", endpoint: "https://api.example.test", issuer: "https://idp.example.test", userId: "verified-subject", sessionId: "private-token" };

test("keys use the complete verified binding and never email or token fallbacks", () => {
  const key = accountActorStorageKey(session, session.endpoint);
  expect(key).toBeDefined();
  expect(key).not.toContain(session.email);
  expect(key).not.toContain(session.sessionId);
  expect(accountActorStorageKey({ ...session, userId: undefined }, session.endpoint)).toBeUndefined();
  expect(accountActorStorageKey({ ...session, issuer: undefined }, session.endpoint)).toBeUndefined();
  expect(accountActorStorageKey({ ...session, endpoint: undefined }, session.endpoint)).toBeUndefined();
  expect(accountActorStorageKey(session, "https://other.example.test")).toBeUndefined();
  expect(accountActorStorageKey({ ...session, issuer: "https://idp.example.test?token=private" }, session.endpoint)).toBeUndefined();
});

test("a logout and same-token login still invalidate the former operation generation", () => {
  storeAccountSession(session);
  const request = captureAccountSessionRequest(session.endpoint);
  const before = getAccountSessionGeneration();
  request.assertCurrent();
  clearStoredAccountSession();
  storeAccountSession(session);
  expect(getAccountSessionGeneration()).not.toBe(before);
  expect(before).toMatch(/^.+:\d+$/);
  expect(() => request.assertCurrent()).toThrow("账号或云服务已变化");
});

test("renewal keeps the original actor and in-flight operation generation", () => {
  storeAccountSession(session);
  const request = captureAccountSessionRequest(session.endpoint);
  const generation = getAccountSessionGeneration();
  replaceRefreshedAccountSession({ ...session, sessionId: "renewed-token" }, generation);
  expect(getAccountSessionGeneration()).toBe(generation);
  expect(() => request.assertCurrent()).not.toThrow();
  expect(accountActorStorageKey(session, session.endpoint)).toBe(request.actorKey);
  expect(() => replaceRefreshedAccountSession({ ...session, userId: "other" }, generation)).toThrow("oauth_session_changed");
  clearStoredAccountSession();
  storeAccountSession(session);
  expect(() => replaceRefreshedAccountSession(session, generation)).toThrow("oauth_session_changed");
});
