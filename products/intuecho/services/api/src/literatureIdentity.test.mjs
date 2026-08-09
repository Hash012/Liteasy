import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalLiteratureKey,
  LiteratureIdentityConflictError,
  mergeLiteratureRecords,
  normalizeLiteratureIdentifier,
  titleAuthorsYearFingerprint
} from "./literatureIdentity.mjs";

function identifier(kind, value, source = "manual") {
  return { kind, source, value };
}

function fixture({ literatureId, identifiers = [], title = "A Paper", authors = ["A. Author"], year = 2026 }) {
  return { authors, identifiers, literatureId, title, year };
}

function doi(value, source) {
  return identifier("doi", value, source);
}

test("normalizes DOI, arXiv, Semantic Scholar and OpenAlex identifiers", () => {
  assert.equal(normalizeLiteratureIdentifier("doi", "https://doi.org/10.1000/ABC."), "10.1000/abc");
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "arXiv:2401.01234v2"), "2401.01234");
  assert.equal(normalizeLiteratureIdentifier("semantic_scholar_id", "CorpusID: 123"), "corpus:123");
  assert.equal(normalizeLiteratureIdentifier("openalex_id", "https://openalex.org/W123"), "W123");
});

test("normalizes arXiv abs and PDF URLs to the versionless identifier", () => {
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "https://arxiv.org/abs/2401.01234v2"), "2401.01234");
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "https://arxiv.org/pdf/2401.01234v2.pdf"), "2401.01234");
});

test("canonicalizes case-insensitive OpenAlex work identifiers", () => {
  assert.equal(normalizeLiteratureIdentifier("openalex_id", "w123"), "W123");
  assert.equal(normalizeLiteratureIdentifier("openalex_id", "https://openalex.org/w456"), "W456");
  assert.throws(
    () => normalizeLiteratureIdentifier("openalex_id", "authors/A123"),
    (error) => error instanceof LiteratureIdentityConflictError && error.code === "LITERATURE_IDENTITY_REQUIRED"
  );
});

test("fingerprints normalized title, ordered authors, and year", () => {
  assert.equal(
    titleAuthorsYearFingerprint({
      authors: [" Ada Lovelace ", "Alan Turing"],
      title: "A Study: Identity!",
      year: 2026
    }),
    "sha256:b9224d03b956914b25d78ac1c350a64951226cbca35bb9d6575d4aa3624da19f"
  );
  assert.equal(
    titleAuthorsYearFingerprint({
      authors: ["Alan Turing", "Ada Lovelace"],
      title: "A Study: Identity!",
      year: 2026
    }),
    "sha256:4a9a471c4e334a10f5f7dc3c4384547627427574fca9c2dfd3791306e1bdf100"
  );
});

test("does not create a fingerprint from title-only data", () => {
  assert.throws(
    () => titleAuthorsYearFingerprint({ authors: [], title: "A Title", year: 2026 }),
    (error) => error instanceof LiteratureIdentityConflictError && error.code === "LITERATURE_IDENTITY_REQUIRED"
  );
  assert.throws(
    () => titleAuthorsYearFingerprint({ authors: ["A. Author"], title: "A Title" }),
    (error) => error instanceof LiteratureIdentityConflictError && error.code === "LITERATURE_IDENTITY_REQUIRED"
  );
});

test("uses stable identifier precedence for canonical keys", () => {
  const record = fixture({
    literatureId: "literature_a",
    identifiers: [
      identifier("title_authors_year_hash", "sha256:one"),
      identifier("openalex_id", "https://openalex.org/W123"),
      doi("https://doi.org/10.1000/ABC.")
    ]
  });
  assert.equal(canonicalLiteratureKey(record), "doi:10.1000/abc");
  assert.throws(
    () => canonicalLiteratureKey({ title: "A Title", authors: ["A. Author"], year: 2026 }),
    (error) => error instanceof LiteratureIdentityConflictError && error.code === "LITERATURE_IDENTITY_REQUIRED"
  );
});

test("rejects records whose identifiers resolve to different literature ids", () => {
  assert.throws(() => mergeLiteratureRecords([
    fixture({ literatureId: "literature_a", identifiers: [doi("10.1000/a")] }),
    fixture({ literatureId: "literature_b", identifiers: [doi("10.1000/a")] })
  ]), (error) => error instanceof LiteratureIdentityConflictError && error.code === "LITERATURE_IDENTITY_CONFLICT");
});

test("does not merge title-only records or upgrade legacy identifier provenance", () => {
  const legacy = fixture({
    literatureId: "literature_a",
    identifiers: [doi("https://doi.org/10.1000/A.", "inferred")],
    title: "Same title",
    authors: ["A. Author"],
    year: 2026
  });
  const titleOnly = fixture({
    literatureId: "literature_b",
    identifiers: [],
    title: "Same title",
    authors: ["A. Author"],
    year: 2026
  });

  const merged = mergeLiteratureRecords([legacy, titleOnly]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].identifiers[0].source, "inferred");
  assert.equal(merged[0].identifiers[0].value, "https://doi.org/10.1000/A.");
  assert.deepEqual(merged[1].identifiers, []);
});
