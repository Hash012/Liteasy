import { expect, test } from "vitest";
import { paperSourceReferences } from "../app/features/resource-filesystem/assetSourceReferences";
import { assertExternalPaperSources, assertExternalSourceReferences } from "../app/features/models/externalSourcePolicy";

test("keeps legacy organization provenance without inventing a document revision", () => {
  const source = { id: "manual", sourcePath: "org://team/shared-library/manual.pdf" };
  const references = paperSourceReferences(source);
  expect(references).toEqual([{ paperId: "manual", scopeId: "team", scopeType: "organization" }]);
  expect(() => assertExternalSourceReferences(references)).toThrow("属于组织");
  expect(() => assertExternalPaperSources([source])).toThrow("属于组织");
  expect(paperSourceReferences({ id: "local", sourcePath: "/library/manual.pdf" })).toEqual([]);
});
