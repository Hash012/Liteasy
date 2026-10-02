import { expect, test } from "vitest";
import { describeResourceIdentity } from "../app/features/resource-filesystem/resourceIdentity";
import { parseLiteasyPath } from "../app/features/resource-filesystem/liteasyPath";

test("logical object identity survives source moves while pinned revision and selector remain separate", () => {
  const target = { kind: "object" as const, ref: { objectId: "book-A", revision: "r1", selectorId: "chapter-4" } };
  const original = describeResourceIdentity("local", target, { contentHash: "sha-A", sourcePath: "D:\\Books\\Guide.html" });
  const moved = describeResourceIdentity("local", target, { contentHash: "sha-A", sourcePath: "/books/renamed.html" });
  const replaced = describeResourceIdentity("local", { ...target, ref: { ...target.ref, revision: "r2" } }, { contentHash: "sha-B", sourcePath: moved.sourcePath });
  expect(moved.key).toBe(original.key);
  expect(moved.locator).toBe(original.locator);
  expect(replaced.key).toBe(original.key);
  expect(replaced.locator).not.toBe(original.locator);
  expect(replaced).toMatchObject({ revision: "r2", contentHash: "sha-B", selectorId: "chapter-4", stability: "logical" });
  expect(parseLiteasyPath(original.locator, "local")).toMatchObject(target);
  expect(parseLiteasyPath(original.key, "local")).toMatchObject({ kind: "object", followLatest: true, ref: { objectId: "book-A" } });
  expect(new URL(original.key).searchParams.has("selector")).toBe(false);
});

test("same bytes preserve distinct existing resource identities and scopes", () => {
  const first = describeResourceIdentity("local", { kind: "object", ref: { objectId: "copy-A", revision: "r1" } }, { contentHash: "same-bytes" });
  const second = describeResourceIdentity("local", { kind: "object", ref: { objectId: "copy-B", revision: "r1" } }, { contentHash: "same-bytes" });
  const otherScope = describeResourceIdentity("user:other", { kind: "object", ref: { objectId: "copy-A", revision: "r1" } }, { contentHash: "same-bytes" });
  expect(first.contentHash).toBe(second.contentHash);
  expect(new Set([first.key, second.key, otherScope.key]).size).toBe(3);
});

test("labels legacy hash IDs and file path locators honestly without folding path case", () => {
  const paper = describeResourceIdentity("local", { kind: "paper", paperId: `paper-${"a".repeat(64)}` }, { contentHash: "a".repeat(64) });
  expect(paper.stability).toBe("content-addressed");
  const lower = describeResourceIdentity("local", { kind: "external-file", mountId: "mount", path: "notes/guide.md" });
  const upper = describeResourceIdentity("local", { kind: "external-file", mountId: "mount", path: "notes/Guide.md" });
  expect(lower.stability).toBe("path");
  expect(lower.key).not.toBe(upper.key);
});
