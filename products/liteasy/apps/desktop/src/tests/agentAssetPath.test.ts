import { expect, test } from "vitest";
import { findKnownAgentAsset } from "../app/features/resource-filesystem/agentAssetPath";
import type { AgentAsset } from "../app/features/resource-filesystem/agentAsset.types";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";

const scope = "user:local";
const asset = (revision: string, selectorId?: string): AgentAsset => ({
  path: liteasyPath(scope, { kind: "object", ref: { objectId: "CicN", revision, selectorId } }),
  revision, title: "CicN", kind: "content.note", capabilities: ["read", "write"]
});

test("resolves equivalent known URLs to the original pinned asset without discovering another version", () => {
  const note = asset("v1");
  for (const path of ["liteasy://objects/CicN", "liteasy://objects/CicN?revision=v1&scope=user:local", "liteasy://objects/%43icN?scope=user%3Alocal"]) {
    expect(findKnownAgentAsset(path, [note], scope)).toBe(note);
  }
});

test("does not widen account, selection, revision or object access", () => {
  const note = asset("v1", "paragraph-1");
  for (const path of ["liteasy://objects/CicN", "liteasy://objects/CicN?selector=paragraph-2", "liteasy://objects/CicN?selector=paragraph-1&revision=v2",
    "liteasy://objects/CicN?selector=paragraph-1&scope=user:elsewhere", "liteasy://objects/other?selector=paragraph-1", "liteasy://objects/CicN?selector=paragraph-1&scope=user:local&scope=user:local"]) {
    expect(findKnownAgentAsset(path, [note], scope)).toBeUndefined();
  }
});

test("requires an exact revision when multiple attached snapshots share an object", () => {
  const old = asset("v1"), newer = asset("v2");
  expect(findKnownAgentAsset("liteasy://objects/CicN", [old, newer], scope)).toBeUndefined();
  expect(findKnownAgentAsset("liteasy://objects/CicN?revision=v2", [old, newer], scope)).toBe(newer);
});
