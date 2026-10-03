import assert from "node:assert/strict";
import test from "node:test";
import { createReplySchema } from "@intuecho/contracts";

test("reply contracts preserve a valid parent snapshot and reject contradictory scope claims", () => {
  const body = { body: "A synthetic question", publishAsAnnotation: false, tags: [], targets: [] };
  const expectedParent = { revision: 2, visibility: "organization", organizationId: "org_x" };
  assert.deepEqual(createReplySchema.parse({ ...body, expectedParent }).expectedParent, expectedParent);
  assert.equal(createReplySchema.safeParse(body).success, true);
  for (const invalid of [
    { revision: 0, visibility: "organization", organizationId: "org_x" },
    { revision: 1, visibility: "organization" },
    { revision: 1, visibility: "organization", organizationId: null },
    { revision: 1, visibility: "public", organizationId: "org_x" },
    { revision: 1, visibility: "private", organizationId: "org_x" }
  ]) assert.equal(createReplySchema.safeParse({ ...body, expectedParent: invalid }).success, false);
});
