import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationTargetSchema,
  desktopAnnotationPublicationBatchSchema,
  literatureConfirmInputSchema,
  literatureRecordSchema,
  literatureResolveInputSchema
} from "@intuecho/contracts";

test("requires a stable manual identity or title-author-year", () => {
  const base = { authors: [], identifiers: [], title: "Unindexed Work" };
  assert.equal(literatureConfirmInputSchema.safeParse({ mode: "manual", record: base }).success, false);
  assert.equal(literatureConfirmInputSchema.safeParse({
    mode: "manual",
    record: { ...base, authors: ["Ada Lovelace"], year: 1843 }
  }).success, true);
});

test("accepts OpenAlex and preserves manual provenance", () => {
  const parsed = literatureRecordSchema.parse({
    authors: ["A. Author"],
    identifiers: [{ kind: "openalex_id", source: "manual", value: "W123" }],
    literatureId: "literature_1",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
    title: "A Paper"
  });
  assert.equal(parsed.identifiers[0].source, "manual");
});

test("keeps record identifier sources aligned with its confirmation provenance", () => {
  const record = {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/test" }],
    literatureId: "literature_1",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
    title: "A Paper"
  };
  assert.equal(literatureRecordSchema.safeParse(record).success, false);
  assert.equal(literatureRecordSchema.safeParse({
    ...record,
    identifiers: [{ kind: "doi", source: "manual", value: "10.1000/test" }]
  }).success, true);
});

test("does not let manual confirmation claim provider data", () => {
  const record = {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/test" }],
    title: "Unindexed Work",
    year: 1843
  };
  assert.equal(literatureConfirmInputSchema.safeParse({ mode: "manual", record }).success, false);
  assert.equal(literatureConfirmInputSchema.safeParse({
    mode: "manual",
    record: { ...record, identifiers: [{ kind: "doi", source: "manual", value: "10.1000/test" }] }
  }).success, true);
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
    pdfBytes: "base64",
    purpose: "liteasy_pdf_annotation",
    query: "10.1000/test"
  }).success, false);
});

test("accepts confirmed references but retains legacy annotation targets", () => {
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
  }).success, true);
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
