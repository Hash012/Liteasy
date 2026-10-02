import { liteasyPath, type ResourceTarget } from "./liteasyPath";

/** An adapter over existing locators, not a new identity registry or a file grant. */
export type ResourceIdentity = {
  key: string;
  locator: string;
  stability: "logical" | "content-addressed" | "path";
  revision?: string;
  selectorId?: string;
  contentHash?: string;
  sourcePath?: string;
};

/** Keep the logical resource, pinned reference, bytes and source location separate. */
export function describeResourceIdentity(scopeId: string, target: ResourceTarget,
  version: { contentHash?: string; sourcePath?: string; revision?: string } = {}): ResourceIdentity {
  const locator = liteasyPath(scopeId, target);
  const logicalTarget: ResourceTarget = target.kind === "object"
    ? { kind: "object", ref: { objectId: target.ref.objectId, revision: target.ref.revision }, followLatest: true }
    : target;
  const revision = target.kind === "object" ? target.ref.revision : version.revision;
  return {
    key: liteasyPath(scopeId, logicalTarget), locator,
    // Existing paper IDs can be content-addressed; external paths are not rename-stable IDs.
    stability: target.kind === "external-file" ? "path"
      : target.kind === "paper" && /^paper-[a-f0-9]{64}$/i.test(target.paperId) ? "content-addressed" : "logical",
    ...(revision && revision !== "latest" ? { revision } : {}),
    ...(target.kind === "object" && target.ref.selectorId ? { selectorId: target.ref.selectorId } : {}),
    ...(version.contentHash ? { contentHash: version.contentHash } : {}),
    ...(version.sourcePath ? { sourcePath: version.sourcePath } : {})
  };
}
