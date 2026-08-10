import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isLegacyTitleAuthorsYearHash,
  normalizeLiteratureIdentifier,
  titleAuthorsYearFingerprint
} from "./literatureIdentity.mjs";

const fixture = JSON.parse(readFileSync(new URL(
  "../../../../../development/test-data/literature-identity/conformance.json",
  import.meta.url
), "utf8"));

test("Intuecho identifier normalization conforms to the shared fixtures", () => {
  for (const item of fixture.identifiers) {
    for (const input of item.inputs) {
      assert.equal(normalizeLiteratureIdentifier(item.kind, input), item.expected);
    }
  }
});

test("Intuecho fingerprints and legacy aliases conform to the shared fixtures", () => {
  for (const item of fixture.fingerprints) {
    assert.equal(titleAuthorsYearFingerprint(item.input), item.expected);
  }
  for (const value of fixture.legacyTitleAuthorYearHashes) {
    assert.equal(isLegacyTitleAuthorsYearHash(value), true);
  }
});
