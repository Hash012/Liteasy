import assert from "node:assert/strict";
import test from "node:test";
import {
  isCandidateLiteratureAliasKind,
  isConfirmableLiteratureIdentifierKind,
  LiteratureIdentityConflictError,
  normalizeLiteratureIdentifier,
  sameLiteratureVersionBibliography,
  titleAuthorsYearFingerprint
} from "./literatureIdentity.mjs";

test("classifies confirmable external identifiers separately from candidate aliases", () => {
  for (const kind of ["doi", "arxiv_id", "semantic_scholar_id", "openalex_id"]) {
    assert.equal(isConfirmableLiteratureIdentifierKind(kind), true);
    assert.equal(isCandidateLiteratureAliasKind(kind), false);
  }
  assert.equal(isConfirmableLiteratureIdentifierKind("title_authors_year_hash"), false);
  assert.equal(isCandidateLiteratureAliasKind("title_authors_year_hash"), true);
  assert.equal(isConfirmableLiteratureIdentifierKind("unknown"), false);
  assert.equal(isCandidateLiteratureAliasKind("unknown"), false);
});

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

test("fingerprints normalized title, complete author set, and year regardless of author order", () => {
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
    "sha256:b9224d03b956914b25d78ac1c350a64951226cbca35bb9d6575d4aa3624da19f"
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

test("requires both sources to identify the same version class before bibliography corroboration", () => {
  const record = {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/versioned" }],
    title: "A Versioned Work",
    year: 2026
  };
  assert.equal(sameLiteratureVersionBibliography(
    { ...record, documentType: "journal-article" },
    { ...record, documentType: "article" }
  ), true);
  assert.equal(sameLiteratureVersionBibliography(
    { ...record, documentType: "journal-article" },
    record
  ), false);
  assert.equal(sameLiteratureVersionBibliography(record, record), false);
});
