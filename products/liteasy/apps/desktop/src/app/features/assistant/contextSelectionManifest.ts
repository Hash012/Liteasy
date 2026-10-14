import type { AssistantContextToken } from "./assistant.types";
import type { ContextRef } from "../context/objectContext";

export function contextReferenceIdentity(ref: ContextRef): string {
  if ("objectId" in ref) return JSON.stringify(["object", ref.objectId, ref.revision, ref.selectorId ?? null]);
  if (ref.type === "setting") return JSON.stringify([ref.type, ref.key]);
  return JSON.stringify([ref.type, ref.code, ref.stage, ref.message]);
}

/** Resolvers have canonicalized aliases and fixed revisions before this merge. */
export function mergeContextSelection(existing: readonly AssistantContextToken[], incoming: AssistantContextToken): AssistantContextToken | undefined {
  if (!incoming.contextRefs?.length) return existing.some((token) => token.id === incoming.id) ? undefined : incoming;
  const seen = new Set(existing.flatMap((token) => token.contextRefs ?? []).map(contextReferenceIdentity));
  const refs = incoming.contextRefs.filter((ref) => {
    const identity = contextReferenceIdentity(ref);
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
  return refs.length ? { ...incoming, contextRefs: refs } : undefined;
}
