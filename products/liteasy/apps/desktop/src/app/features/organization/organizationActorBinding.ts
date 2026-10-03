import type { AccountSession } from "../account/account.types";
import { accountActorStorageKey } from "../account/accountSessionBinding";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";

export function organizationActorBinding(session: AccountSession | null, endpoint: string) {
  return JSON.stringify([accountActorStorageKey(session, endpoint), endpoint.replace(/\/+$/, ""),
    session?.issuer, session?.userId, session?.sessionId, getAccountSessionGeneration()]);
}

export function organizationSessionMatchesEndpoint(session: AccountSession, endpoint: string) {
  return Boolean(session.sessionId && accountActorStorageKey(session, endpoint));
}
