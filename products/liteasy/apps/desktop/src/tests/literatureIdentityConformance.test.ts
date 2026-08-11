import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  isLegacyTitleAuthorsYearHash,
  normalizeLiteratureIdentifier,
  titleAuthorsYearFingerprint
} from "../app/features/paper-identity/paperIdentity";
import { parsePmlrHint } from "../app/features/paper-identity/literatureRecord";

type Fixture = {
  fingerprints: Array<{
    expected: string;
    input: { authors: string[]; title: string; year: number };
  }>;
  identifiers: Array<{ expected: string; inputs: string[]; kind: string }>;
  legacyTitleAuthorYearHashes: string[];
  pmlrHints: Array<{
    expected: { source: "pmlr"; volume: number; year: number };
    input: string;
  }>;
};

const fixture = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "../../../../development/test-data/literature-identity/conformance.json"
), "utf8")) as Fixture;

describe("literature identity conformance", () => {
  test("normalizes stable identifiers against the shared fixtures", () => {
    for (const item of fixture.identifiers) {
      for (const input of item.inputs) {
        expect(normalizeLiteratureIdentifier(item.kind, input)).toBe(item.expected);
      }
    }
  });

  test("creates canonical title-author-year fingerprints", () => {
    for (const item of fixture.fingerprints) {
      expect(titleAuthorsYearFingerprint(item.input)).toBe(item.expected);
    }
  });

  test("rejects malformed confirmable identifiers and candidate hashes", () => {
    expect(normalizeLiteratureIdentifier("doi", "not-a-doi")).toBe("");
    expect(normalizeLiteratureIdentifier("doi", "https://doi.org/10.1000/valid?utm_source=tracker")).toBe("");
    expect(normalizeLiteratureIdentifier("semantic_scholar_id", "not-an-id")).toBe("");
    expect(normalizeLiteratureIdentifier("title_authors_year_hash", "metadata-title")).toBe("");
  });

  test("recognizes legacy aliases and bounded PMLR volume hints", () => {
    for (const value of fixture.legacyTitleAuthorYearHashes) {
      expect(isLegacyTitleAuthorsYearHash(value)).toBe(true);
    }
    for (const item of fixture.pmlrHints) {
      expect(parsePmlrHint(item.input)).toEqual(item.expected);
    }
  });
});
