import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkResolutionRequest,
  buildWorkResolutionSnapshot
} from "./identityResolutionPayloads.mjs";

test("buildWorkResolutionRequest accepts a valid identity set", () => {
  const result = buildWorkResolutionRequest({
    identities: [{ kind: "doi", value: "10.1/abc" }],
    title: "  ColBERT  ",
    year: 2021,
    type: "conference"
  });
  assert.ok(result.value);
  assert.equal(result.value.identities[0].kind, "doi");
  assert.equal(result.value.meta.title, "ColBERT");
  assert.equal(result.value.meta.year, 2021);
});

test("buildWorkResolutionRequest rejects empty identities", () => {
  assert.equal(buildWorkResolutionRequest({ identities: [] }).error, "invalid_work_identity_count");
  assert.equal(
    buildWorkResolutionRequest({}).error,
    "invalid_work_identity_count"
  );
});

test("buildWorkResolutionRequest rejects invalid kind and oversized value", () => {
  assert.equal(
    buildWorkResolutionRequest({ identities: [{ kind: "bogus", value: "x" }] }).error,
    "invalid_work_identity_kind"
  );
  assert.equal(
    buildWorkResolutionRequest({ identities: [{ kind: "doi", value: "x".repeat(600) }] }).error,
    "invalid_work_identity_value"
  );
});

test("buildWorkResolutionRequest caps identity count at 32", () => {
  const identities = Array.from({ length: 33 }, (_, i) => ({ kind: "doi", value: `10.1/${i}` }));
  assert.equal(
    buildWorkResolutionRequest({ identities }).error,
    "invalid_work_identity_count"
  );
});

test("buildWorkResolutionSnapshot omits raw embeddings and exposes version", () => {
  const snapshot = buildWorkResolutionSnapshot(
    {
      created: true,
      identifiers: [{ kind: "doi", value: "10.1/abc" }],
      work: { id: "w_1", title: "T" }
    },
    7
  );
  assert.equal(snapshot.created, true);
  assert.equal(snapshot.personalizationVersion, 7);
  assert.equal(snapshot.work.id, "w_1");
  assert.ok(!("embedding" in snapshot));
});
