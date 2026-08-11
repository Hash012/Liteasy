import assert from "node:assert/strict";
import test from "node:test";
import {
  isCandidateLiteratureAliasKind,
  isConfirmableLiteratureIdentifierKind,
  LiteratureIdentityConflictError,
  normalizeLiteratureIdentifier,
  normalizeLiteratureRelations,
  sameLiteratureVersionBibliography,
  titleAuthorsYearFingerprint
} from "./literatureIdentity.mjs";

test("classifies confirmable external identifiers separately from candidate aliases", () => {
  for (const kind of [
    "doi",
    "arxiv_id",
    "semantic_scholar_id",
    "openalex_id",
    "openreview_id",
    "dblp_key",
    "pmlr_id"
  ]) {
    assert.equal(isConfirmableLiteratureIdentifierKind(kind), true);
    assert.equal(isCandidateLiteratureAliasKind(kind), false);
  }
  assert.equal(isConfirmableLiteratureIdentifierKind("title_authors_year_hash"), false);
  assert.equal(isCandidateLiteratureAliasKind("title_authors_year_hash"), true);
  assert.equal(isConfirmableLiteratureIdentifierKind("unknown"), false);
  assert.equal(isCandidateLiteratureAliasKind("unknown"), false);
});

test("normalizes registry and computer-science source identifiers", () => {
  assert.equal(normalizeLiteratureIdentifier("doi", "https://doi.org/10.1000/ABC."), "10.1000/abc");
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "arXiv:2401.01234v2"), "2401.01234v2");
  assert.equal(normalizeLiteratureIdentifier("semantic_scholar_id", "CorpusID: 123"), "corpus:123");
  assert.equal(normalizeLiteratureIdentifier("openalex_id", "https://openalex.org/W123"), "W123");
  assert.equal(
    normalizeLiteratureIdentifier("openreview_id", "https://openreview.net/forum?id=AbC_123-x"),
    "AbC_123-x"
  );
  assert.equal(
    normalizeLiteratureIdentifier("dblp_key", "https://dblp.org/rec/conf/icml/Smith26.html"),
    "conf/icml/Smith26"
  );
  assert.equal(
    normalizeLiteratureIdentifier("pmlr_id", "https://proceedings.mlr.press/v235/abad-rocamora24a.html"),
    "v235/abad-rocamora24a"
  );
  assert.equal(
    normalizeLiteratureIdentifier("pmlr_id", "pmlr-v236-abad-rocamora24a"),
    "v236/abad-rocamora24a"
  );
});

test("rejects malformed OpenReview and DBLP identifiers", () => {
  assert.throws(() => normalizeLiteratureIdentifier("doi", "not-a-doi"), /LITERATURE_IDENTITY_REQUIRED/);
  assert.throws(
    () => normalizeLiteratureIdentifier("doi", "https://doi.org/10.1000/valid?utm_source=tracker"),
    /LITERATURE_IDENTITY_REQUIRED/
  );
  assert.throws(
    () => normalizeLiteratureIdentifier("semantic_scholar_id", "not-an-id"),
    /LITERATURE_IDENTITY_REQUIRED/
  );
  assert.throws(
    () => normalizeLiteratureIdentifier("title_authors_year_hash", "metadata-title"),
    /LITERATURE_IDENTITY_REQUIRED/
  );
  assert.throws(() => normalizeLiteratureIdentifier("openreview_id", "under review"), /LITERATURE_IDENTITY_REQUIRED/);
  assert.throws(() => normalizeLiteratureIdentifier("dblp_key", "../private"), /LITERATURE_IDENTITY_REQUIRED/);
  assert.throws(() => normalizeLiteratureIdentifier("pmlr_id", "v235/../private"), /LITERATURE_IDENTITY_REQUIRED/);
});

test("keeps the PMLR volume in the stable paper identity", () => {
  assert.notEqual(
    normalizeLiteratureIdentifier("pmlr_id", "v235/shared-paper24a"),
    normalizeLiteratureIdentifier("pmlr_id", "v236/shared-paper24a")
  );
});

test("preserves the arXiv revision in abs and PDF identifiers", () => {
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "https://arxiv.org/abs/2401.01234v2"), "2401.01234v2");
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "https://arxiv.org/pdf/2401.01234v2.pdf"), "2401.01234v2");
  assert.notEqual(
    normalizeLiteratureIdentifier("arxiv_id", "2401.01234v1"),
    normalizeLiteratureIdentifier("arxiv_id", "2401.01234v2")
  );
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

test("does not corroborate matching bibliographies with conflicting authoritative identifiers", () => {
  const record = {
    authors: ["A. Author"],
    documentType: "journal-article",
    title: "A Versioned Work",
    year: 2026
  };
  assert.equal(sameLiteratureVersionBibliography(
    { ...record, identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/first" }] },
    { ...record, identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/second" }] }
  ), false);
  assert.equal(sameLiteratureVersionBibliography(
    { ...record, identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W1" }] },
    { ...record, identifiers: [{ kind: "semantic_scholar_id", source: "public_registry", value: "corpus:2" }] }
  ), true);
});

test("accepts only concrete confirmable identifiers as version relation targets", () => {
  const relation = (targetIdentifier) => ({
    direction: "from_current",
    evidence: { sourceField: "provider:relation" },
    relationType: "version_of",
    targetIdentifier
  });

  assert.deepEqual(normalizeLiteratureRelations([
    relation({ kind: "doi", value: "https://doi.org/10.1000/related" })
  ])[0].targetIdentifier, { kind: "doi", value: "10.1000/related" });
  assert.deepEqual(normalizeLiteratureRelations([
    relation({ kind: "title_authors_year_hash", value: `sha256:${"a".repeat(64)}` }),
    relation({ kind: "arxiv_id", value: "2401.01234" })
  ]), []);
});
