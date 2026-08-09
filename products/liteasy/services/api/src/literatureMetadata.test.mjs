import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLiteratureMetadata } from "./literatureMetadata.mjs";

export const manualLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "manual", value: "10.1000/liteasy" }],
  literatureId: "literature:doi:10.1000/liteasy",
  provenance: {
    confirmedAt: "2026-08-09T00:00:00.000Z",
    mode: "manual"
  },
  title: "Cloud Literature Metadata",
  year: 2026
};

test("normalizes a Liteasy-owned manual literature record", () => {
  assert.deepEqual(normalizeLiteratureMetadata({
    ...manualLiterature,
    authors: ["  Ada   Lovelace  "],
    title: "  Cloud   Literature Metadata  "
  }), manualLiterature);
});

test("rejects provenance that would present inferred identifiers as confirmed manual data", () => {
  assert.throws(() => normalizeLiteratureMetadata({
    ...manualLiterature,
    identifiers: [{ kind: "doi", source: "inferred", value: "10.1000/liteasy" }]
  }), /literature_metadata_invalid/);
});

test("rejects unknown literature fields at the Liteasy API boundary", () => {
  assert.throws(() => normalizeLiteratureMetadata({
    ...manualLiterature,
    providerPayload: { secret: "must not persist" }
  }), /literature_metadata_invalid/);
});

test("accepts a public-registry record without importing Intuecho contracts", () => {
  const record = normalizeLiteratureMetadata({
    ...manualLiterature,
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
    literatureId: "literature:openalex:W123",
    provenance: {
      confirmedAt: "2026-08-09T00:00:00.000Z",
      mode: "public_registry",
      provider: "openalex"
    }
  });

  assert.equal(record.provenance.provider, "openalex");
  assert.equal(record.identifiers[0].source, "public_registry");
});
