import type { AgentAsset } from "./agentAsset.types";
import { liteasyPath, parseLiteasyPath } from "./liteasyPath";

/** Match only discovered resources. URL spelling never widens scope, revision or selection. */
export function findKnownAgentAsset(path: string, known: Iterable<AgentAsset>, scope: string) {
  try {
    const requested = parseLiteasyPath(path, scope);
    const matches = [...known].filter((asset) => {
      const target = parseLiteasyPath(asset.path, scope);
      if (requested.kind === "object" && target.kind === "object") {
        return requested.ref.objectId === target.ref.objectId && requested.ref.selectorId === target.ref.selectorId &&
          (requested.followLatest || requested.ref.revision === target.ref.revision || requested.ref.revision === asset.revision);
      }
      return liteasyPath(scope, requested) === liteasyPath(scope, target);
    });
    // An omitted revision must not pick arbitrarily between two attached snapshots.
    const exact = matches.find((asset) => liteasyPath(scope, parseLiteasyPath(asset.path, scope)) === liteasyPath(scope, requested));
    return exact ?? (matches.length === 1 ? matches[0] : undefined);
  } catch {
    return undefined;
  }
}
