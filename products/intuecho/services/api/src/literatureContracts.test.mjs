import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationTargetSchema,
  candidateLiteratureAliasKindSchema,
  confirmableLiteratureIdentifierKindSchema,
  createReplySchema,
  desktopAnnotationPublicationBatchSchema,
  literatureCandidateSchema,
  literatureConfirmInputSchema,
  literatureIdentityClaimSchema,
  literatureRecordSchema,
  literatureRelationsResultSchema,
  literatureResolveInputSchema,
  updateReplyPublicationSchema
} from "@intuecho/contracts";

test("separates confirmable identifier kinds from candidate aliases", () => {
  for (const kind of [
    "doi",
    "arxiv_id",
    "openalex_id",
    "semantic_scholar_id",
    "openreview_id",
    "dblp_key",
    "pmlr_id"
  ]) {
    assert.equal(confirmableLiteratureIdentifierKindSchema.safeParse(kind).success, true);
    assert.equal(candidateLiteratureAliasKindSchema.safeParse(kind).success, false);
  }
  assert.equal(confirmableLiteratureIdentifierKindSchema.safeParse("title_authors_year_hash").success, false);
  assert.equal(candidateLiteratureAliasKindSchema.safeParse("title_authors_year_hash").success, true);
});

test("accepts source-confirmed computer-science venue candidates", () => {
  for (const [provider, kind, value] of [
    ["openreview", "openreview_id", "NeurIPS2026-paper"],
    ["dblp", "dblp_key", "conf/aaai/Author26"],
    ["pmlr", "pmlr_id", "v235/abad-rocamora24a"]
  ]) {
    assert.equal(literatureCandidateSchema.safeParse({
      candidateKey: `${provider}:${kind}:${value}`,
      provider,
      record: {
        authors: ["A. Author"],
        documentType: "conference-paper",
        identifiers: [{ kind, source: "public_registry", value }],
        title: "A Conference Paper",
        year: 2026
      },
      recordUrl: provider === "openreview"
        ? `https://openreview.net/forum?id=${value}`
        : provider === "pmlr"
          ? `https://proceedings.mlr.press/${value}.html`
          : `https://dblp.org/rec/${value}`,
      ...(provider === "pmlr" ? {
        sourceEvidence: {
          artifactHash: `sha256:${"a".repeat(64)}`,
          artifactUrl: "https://proceedings.mlr.press/v235/assets/bib/bibliography.bib",
          entryKey: "pmlr-v235-abad-rocamora24a",
          sourceKind: "official_volume_bibtex",
          volume: 235
        }
      } : {})
    }).success, true);
  }
});

test("binds PMLR audit evidence to the exact official record and volume", () => {
  const candidate = {
    candidateKey: "pmlr:pmlr_id:v235/abad-rocamora24a",
    provider: "pmlr",
    record: {
      authors: ["Elias Abad Rocamora"],
      documentType: "conference-paper",
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/abad-rocamora24a" }],
      title: "An ICML Paper",
      year: 2024
    },
    recordUrl: "https://proceedings.mlr.press/v235/abad-rocamora24a.html",
    sourceEvidence: {
      artifactHash: `sha256:${"a".repeat(64)}`,
      artifactUrl: "https://proceedings.mlr.press/v235/assets/bib/bibliography.bib",
      entryKey: "pmlr-v235-abad-rocamora24a",
      sourceKind: "official_volume_bibtex",
      volume: 235
    }
  };

  assert.equal(literatureCandidateSchema.safeParse(candidate).success, true);
  for (const invalid of [
    { ...candidate, sourceEvidence: undefined },
    { ...candidate, recordUrl: "https://proceedings.mlr.press/v236/abad-rocamora24a.html" },
    { ...candidate, sourceEvidence: { ...candidate.sourceEvidence, volume: 236 } },
    { ...candidate, sourceEvidence: { ...candidate.sourceEvidence, entryKey: "pmlr-v235-other24a" } },
    { ...candidate, sourceEvidence: { ...candidate.sourceEvidence, artifactUrl: "https://proceedings.mlr.press/v236/assets/bib/bibliography.bib" } },
    { ...candidate, sourceEvidence: { ...candidate.sourceEvidence, artifactUrl: "https://mirror.example.test/v235/assets/bib/bibliography.bib" } }
  ]) {
    assert.equal(literatureCandidateSchema.safeParse(invalid).success, false);
  }
});

test("validates related confirmed literature versions for user-side consumption", () => {
  const literature = {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/publication" }],
    literatureId: "literature-publication",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
    revision: 1,
    status: "confirmed",
    title: "Published Version",
    year: 2026
  };
  assert.equal(literatureRelationsResultSchema.safeParse({
    claims: [{
      evidence: {
        confirmationBasis: "primary_registry_refetch",
        recordUrl: "https://doi.org/10.1000/preprint",
        sourceTier: "primary"
      },
      identifier: {
        kind: "arxiv_id",
        role: "confirmable",
        source: "public_registry",
        value: "2401.01234v2"
      },
      observedAt: "2026-08-09T00:00:00.000Z",
      provider: "arxiv",
      providerRecordId: "2401.01234v2",
      verificationStatus: "confirmed"
    }],
    literatureId: "literature-preprint",
    versions: [{
      direction: "from_current",
      literature,
      relation: {
        createdAt: "2026-08-09T00:00:00.000Z",
        evidence: { recordUrl: "https://registry.example.test/relation" },
        fromLiteratureId: "literature-preprint",
        provider: "crossref",
        relationType: "is_preprint_of",
        toLiteratureId: "literature-publication",
        verificationStatus: "confirmed"
      }
    }]
  }).success, true);
  assert.equal(literatureIdentityClaimSchema.safeParse({
    evidence: {},
    identifier: literature.identifiers[0],
    observedAt: "2026-08-09T00:00:00.000Z",
    provider: "intuecho",
    providerRecordId: "internal",
    verificationStatus: "confirmed"
  }).success, false);
});

test("accepts only source-confirmed candidate modes", () => {
  assert.equal(literatureConfirmInputSchema.safeParse({ mode: "candidate", candidateKey: "crossref:doi:10.1000/test" }).success, true);
  assert.equal(literatureConfirmInputSchema.safeParse({ mode: "corroborated", candidateKey: "openalex:openalex_id:W123" }).success, true);
  assert.equal(literatureConfirmInputSchema.safeParse({
    mode: "manual",
    record: { authors: ["Ada Lovelace"], identifiers: [], title: "Unindexed Work", year: 1843 }
  }).success, false);
});

test("accepts confirmed OpenAlex records with a revision", () => {
  const parsed = literatureRecordSchema.parse({
    authors: ["A. Author"],
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
    literatureId: "literature_1",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "openalex" },
    revision: 1,
    status: "confirmed",
    title: "A Paper"
  });
  assert.equal(parsed.identifiers[0].source, "public_registry");
  assert.equal(parsed.identifiers[0].role, "confirmable");
});

test("normalizes compatibility aliases without presenting them as registry identifiers", () => {
  const parsed = literatureRecordSchema.parse({
    authors: ["A. Author"],
    identifiers: [
      { kind: "doi", source: "public_registry", value: "10.1000/test" },
      { kind: "title_authors_year_hash", source: "public_registry", value: `sha256:${"a".repeat(64)}` }
    ],
    literatureId: "literature_1",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" },
    revision: 1,
    status: "confirmed",
    title: "A Paper"
  });
  assert.deepEqual(parsed.identifiers.map(({ kind, role, source }) => ({ kind, role, source })), [
    { kind: "doi", role: "confirmable", source: "public_registry" },
    { kind: "title_authors_year_hash", role: "candidate_alias", source: "metadata" }
  ]);
  assert.equal(literatureRecordSchema.safeParse({
    ...parsed,
    identifiers: [{ kind: "doi", role: "candidate_alias", source: "public_registry", value: "10.1000/test" }]
  }).success, false);
});

test("rejects unverified record provenance and fingerprint-only formal records", () => {
  const record = {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/test" }],
    literatureId: "literature_1",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" },
    revision: 1,
    status: "confirmed",
    title: "A Paper"
  };
  assert.equal(literatureRecordSchema.safeParse(record).success, true);
  assert.equal(literatureRecordSchema.safeParse({
    ...record,
    identifiers: [{ kind: "doi", source: "manual", value: "10.1000/test" }]
  }).success, false);
  assert.equal(literatureRecordSchema.safeParse({
    ...record,
    identifiers: [{ kind: "title_authors_year_hash", source: "public_registry", value: `sha256:${"a".repeat(64)}` }]
  }).success, false);
  for (const identifier of [
    { kind: "doi", source: "public_registry", value: "not-a-doi" },
    { kind: "arxiv_id", source: "public_registry", value: "2401.01234" }
  ]) {
    assert.equal(literatureRecordSchema.safeParse({
      ...record,
      identifiers: [identifier]
    }).success, false);
  }
});

test("keeps confirmation modes and legacy identities within their source boundaries", () => {
  const manual = {
    authors: ["Ada Lovelace"],
    identifiers: [],
    title: "Unindexed Work",
    year: 1843
  };
  assert.equal(literatureConfirmInputSchema.safeParse({
    mode: "candidate",
    candidateKey: "candidate_1",
    record: manual
  }).success, false);
  assert.equal(literatureConfirmInputSchema.safeParse({
    mode: "manual",
    record: { ...manual, provenance: { mode: "manual" } }
  }).success, false);
  assert.equal(annotationTargetSchema.safeParse({
    kind: "whole_document",
    literature: {
      identity: { id: "doi:10.1000/test", kind: "doi", source: "public_registry", value: "10.1000/test" },
      metadata: { authors: ["A. Author"], title: "A Paper", year: 2026 }
    }
  }).success, false);
});

test("bounds PDF hints without accepting PDF content", () => {
  assert.equal(literatureResolveInputSchema.safeParse({
    hints: { identifiers: [{ kind: "doi", value: "10.1000/test" }], title: "A Paper" },
    purpose: "liteasy_pdf_annotation",
    query: "10.1000/test"
  }).success, true);
  assert.equal(literatureResolveInputSchema.safeParse({ pdfBytes: "base64" }).success, false);
  assert.equal(literatureResolveInputSchema.safeParse({
    hints: { identifiers: [{ kind: "pmlr", value: "v306" }] },
    purpose: "liteasy_pdf_annotation"
  }).success, false);
  assert.equal(literatureResolveInputSchema.safeParse({
    pdfBytes: "base64",
    purpose: "liteasy_pdf_annotation",
    query: "10.1000/test"
  }).success, false);
  assert.equal(literatureResolveInputSchema.safeParse({
    hints: {
      pmlr: { source: "pmlr", volume: 306, year: 2026 },
      title: "HelioX"
    },
    purpose: "liteasy_pdf_annotation"
  }).success, true);
});

test("accepts confirmed references and rejects legacy annotation target writes", () => {
  assert.equal(annotationTargetSchema.safeParse({
    kind: "whole_document",
    literature: { literatureId: "literature_1" }
  }).success, true);
  assert.equal(annotationTargetSchema.safeParse({
    kind: "whole_document",
    literature: {
      identity: { id: "doi:10.1000/test", kind: "doi", source: "metadata", value: "10.1000/test" },
      metadata: { authors: ["A. Author"], title: "A Paper", year: 2026 }
    }
  }).success, false);
  assert.equal(annotationTargetSchema.safeParse({
    kind: "whole_document",
    literature: { literatureId: "literature_1", title: "Replacement metadata" }
  }).success, false);
  assert.equal(annotationTargetSchema.safeParse({
    kind: "whole_document",
    literature: {
      identity: { id: "doi:10.1000/test", kind: "doi", source: "metadata", value: "10.1000/test" },
      literatureId: "literature_1",
      metadata: { authors: ["A. Author"], title: "Replacement metadata", year: 2026 }
    }
  }).success, false);
});

test("validates publication operations without accepting literature metadata or retract visibility", () => {
  const upsert = {
    annotationId: "annotation_1",
    body: "A source annotation.",
    literatureId: "literature_1",
    operation: "upsert",
    queueKey: "queue_1",
    revision: 1,
    sourcePassage: { anchorHash: "sha256:passage", excerpt: "A source passage.", page: 3, rects: [] },
    updatedAt: "2026-08-09T00:00:00.000Z"
  };
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({ operations: [upsert] }).success, true);
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({
    operations: [{ ...upsert, title: "Replacement metadata" }]
  }).success, false);
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({
    operations: [{ ...upsert, provenance: { mode: "public_registry" } }]
  }).success, false);
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({
    operations: [{
      annotationId: "annotation_1",
      operation: "retract",
      queueKey: "queue_1",
      remoteAnnotationId: "remote_1",
      revision: 2,
      updatedAt: "2026-08-09T00:01:00.000Z",
      visibility: "private"
    }]
  }).success, false);
});

test("accepts only strict finite publication rectangles", () => {
  const operation = {
    annotationId: "annotation_1",
    body: "A source annotation.",
    literatureId: "literature_1",
    operation: "upsert",
    queueKey: "queue_1",
    revision: 1,
    sourcePassage: {
      anchorHash: "sha256:passage",
      excerpt: "A source passage.",
      rects: [{ height: 40.5, left: 12, top: 24, width: 180 }]
    },
    updatedAt: "2026-08-09T00:00:00.000Z"
  };
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({ operations: [operation] }).success, true);
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({
    operations: [{
      ...operation,
      sourcePassage: {
        ...operation.sourcePassage,
        rects: [{ height: 40, left: 12, pdfBytes: "base64", top: 24, width: 180 }]
      }
    }]
  }).success, false);
  assert.equal(desktopAnnotationPublicationBatchSchema.safeParse({
    operations: [{
      ...operation,
      sourcePassage: {
        ...operation.sourcePassage,
        rects: [{ height: 40, left: 12, top: 24, width: Number.POSITIVE_INFINITY }]
      }
    }]
  }).success, false);
  assert.equal(annotationTargetSchema.safeParse({
    anchorHash: "sha256:passage",
    excerpt: "A source passage.",
    kind: "source_passage",
    literature: { literatureId: "literature_1" },
    rects: [{ fullText: "must not cross the API", height: 40, left: 12, top: 24, width: 180 }]
  }).success, false);
});

test("creates a pure reply without literature targets by default", () => {
  const parsed = createReplySchema.safeParse({
    body: "Thread-only response",
    tags: [],
    targets: []
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.publishAsAnnotation, false);
});

test("requires targets only when a reply is published as an independent annotation", () => {
  assert.equal(createReplySchema.safeParse({
    body: "Independent response",
    publishAsAnnotation: true,
    tags: [],
    targets: []
  }).success, false);
  assert.equal(createReplySchema.safeParse({
    body: "Thread-only response with an invalid projection target",
    publishAsAnnotation: false,
    tags: [],
    targets: [{ kind: "whole_document", literature: { literatureId: "literature_1" } }]
  }).success, false);
});

test("validates reply publication updates with canonical literature targets", () => {
  const target = { kind: "whole_document", literature: { literatureId: "literature_1" } };
  assert.equal(updateReplyPublicationSchema.safeParse({ published: false }).success, true);
  assert.equal(updateReplyPublicationSchema.safeParse({
    published: true,
    tags: [],
    targets: []
  }).success, false);
  assert.equal(updateReplyPublicationSchema.safeParse({
    published: true,
    tags: ["evidence"],
    targets: [target]
  }).success, true);
  assert.equal(updateReplyPublicationSchema.safeParse({
    published: true,
    tags: [],
    targets: [{
      anchorHash: "sha256:passage",
      excerpt: "A source passage.",
      kind: "source_passage",
      literature: { literatureId: "literature_1" },
      rects: [{ height: 40, left: 12, top: 24, width: 180, unsupported: true }]
    }]
  }).success, false);
});

test("declares optional HTTPS provider record URLs", () => {
  const candidate = {
    candidateKey: "crossref:doi:10.1000/record-url",
    provider: "crossref",
    record: {
      authors: ["A. Author"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/record-url" }],
      title: "A Paper"
    }
  };
  assert.equal(literatureCandidateSchema.parse({
    ...candidate,
    recordUrl: "https://doi.org/10.1000/record-url"
  }).recordUrl, "https://doi.org/10.1000/record-url");
  assert.equal(literatureCandidateSchema.safeParse({
    ...candidate,
    recordUrl: "http://example.test/record-url"
  }).success, false);
});

test("accepts only evidenced provider version relations", () => {
  const candidate = {
    candidateKey: "arxiv:arxiv_id:2401.01234v2",
    provider: "arxiv",
    record: {
      authors: ["A. Author"],
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234v2" }],
      title: "A Preprint"
    },
    relations: [{
      direction: "from_current",
      evidence: { sourceField: "arxiv:doi" },
      relationType: "is_preprint_of",
      targetIdentifier: { kind: "doi", value: "10.1000/publication" }
    }]
  };
  assert.equal(literatureCandidateSchema.safeParse(candidate).success, true);
  assert.equal(literatureCandidateSchema.safeParse({
    ...candidate,
    relations: [{ ...candidate.relations[0], evidence: {} }]
  }).success, false);
  assert.equal(literatureCandidateSchema.safeParse({
    ...candidate,
    relations: [{
      ...candidate.relations[0],
      targetIdentifier: { kind: "title_authors_year_hash", value: `sha256:${"a".repeat(64)}` }
    }]
  }).success, false);
  assert.equal(literatureCandidateSchema.safeParse({
    ...candidate,
    relations: [{
      ...candidate.relations[0],
      targetIdentifier: { kind: "arxiv_id", value: "2401.01234" }
    }]
  }).success, false);
});
