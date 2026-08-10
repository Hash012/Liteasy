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

  test("recognizes legacy aliases and PMLR hints without promoting PMLR to an identity", () => {
    for (const value of fixture.legacyTitleAuthorYearHashes) {
      expect(isLegacyTitleAuthorsYearHash(value)).toBe(true);
    }
    for (const item of fixture.pmlrHints) {
      expect(parsePmlrHint(item.input)).toEqual(item.expected);
    }
  });
});
