import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeLiteratureIdentifier,
  normalizeLiteratureMetadata
} from "./literatureMetadata.mjs";

const conformance = JSON.parse(readFileSync(new URL(
  "../../../../../development/test-data/literature-identity/conformance.json",
  import.meta.url
), "utf8"));

export const confirmedLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/liteasy" }],
  literatureId: "lit_01J00000000000000000000000",
  provenance: {
    confirmedAt: "2026-08-09T00:00:00.000Z",
    mode: "public_registry",
    provider: "crossref"
  },
  revision: 1,
  status: "confirmed",
  title: "Cloud Literature Metadata",
  year: 2026
};

test("normalizes an Intuecho-confirmed literature projection", () => {
  assert.deepEqual(normalizeLiteratureMetadata({
    ...confirmedLiterature,
    authors: ["  Ada   Lovelace  "],
    title: "  Cloud   Literature Metadata  "
  }), confirmedLiterature);
});

test("rejects inferred identifiers and manual provenance as confirmed data", () => {
  assert.throws(() => normalizeLiteratureMetadata({
    ...confirmedLiterature,
    identifiers: [{ kind: "doi", source: "inferred", value: "10.1000/liteasy" }]
  }), /literature_metadata_invalid/);
  assert.throws(() => normalizeLiteratureMetadata({
    ...confirmedLiterature,
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" }
  }), /literature_metadata_invalid/);
});

test("rejects unknown literature fields at the Liteasy API boundary", () => {
  assert.throws(() => normalizeLiteratureMetadata({
    ...confirmedLiterature,
    providerPayload: { secret: "must not persist" }
  }), /literature_metadata_invalid/);
});

test("accepts a public-registry record without importing Intuecho contracts", () => {
  const record = normalizeLiteratureMetadata({
    ...confirmedLiterature,
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

test("conforms to the shared stable identifier fixtures without importing Intuecho", () => {
  for (const item of conformance.identifiers) {
    for (const input of item.inputs) {
      assert.equal(normalizeLiteratureIdentifier(item.kind, input), item.expected);
    }
  }
});
