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
  identifiers: [{ kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/liteasy" }],
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

test("rejects malformed or versionless identifiers in confirmed projections", () => {
  for (const identifier of [
    { kind: "doi", source: "public_registry", value: "not-a-doi" },
    { kind: "semantic_scholar_id", source: "public_registry", value: "paper-123" },
    { kind: "title_authors_year_hash", source: "metadata", value: "metadata-title" },
    { kind: "arxiv_id", source: "public_registry", value: "2401.01234" }
  ]) {
    assert.throws(() => normalizeLiteratureMetadata({
      ...confirmedLiterature,
      identifiers: [identifier]
    }), /literature_metadata_invalid/);
  }
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
  assert.equal(record.identifiers[0].role, "confirmable");
});

test("accepts an Intuecho-confirmed PMLR projection with its volume-qualified id", () => {
  const record = normalizeLiteratureMetadata({
    ...confirmedLiterature,
    identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "pmlr-v235-abad-rocamora24a" }],
    provenance: {
      confirmedAt: "2026-08-09T00:00:00.000Z",
      mode: "public_registry",
      provider: "pmlr"
    }
  });

  assert.equal(record.identifiers[0].value, "v235/abad-rocamora24a");
  assert.equal(record.provenance.provider, "pmlr");
});

test("upgrades old confirmed snapshots with explicit identifier roles", () => {
  const record = normalizeLiteratureMetadata({
    ...confirmedLiterature,
    identifiers: [
      { kind: "doi", source: "public_registry", value: "10.1000/liteasy" },
      { kind: "title_authors_year_hash", source: "public_registry", value: `sha256:${"b".repeat(64)}` }
    ]
  });
  assert.deepEqual(record.identifiers.map(({ kind, role, source }) => ({ kind, role, source })), [
    { kind: "doi", role: "confirmable", source: "public_registry" },
    { kind: "title_authors_year_hash", role: "candidate_alias", source: "metadata" }
  ]);
});

test("conforms to the shared stable identifier fixtures without importing Intuecho", () => {
  for (const item of conformance.identifiers) {
    for (const input of item.inputs) {
      assert.equal(normalizeLiteratureIdentifier(item.kind, input), item.expected);
    }
  }
});
