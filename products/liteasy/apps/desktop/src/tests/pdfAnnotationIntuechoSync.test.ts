import { describe, expect, test } from "vitest";
import {
  createRetractOperation,
  createUpsertOperation
} from "../app/features/pdf/pdfAnnotationIntuechoSync";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import type { LiteratureRecord } from "../app/features/paper-identity/literature.types";

function annotation(input: Partial<PdfAnnotationV2> = {}): PdfAnnotationV2 {
  return {
    createdAt: "2026-07-28T00:00:00.000Z",
    excerpt: "The selected PDF passage.",
    id: "pdf-annotation-1",
    page: 3,
    paperIdentity: {
      candidates: [],
      paperId: "paper-1",
      primary: { id: "local_paper_id:paper-1", kind: "local_paper_id", source: "local", value: "paper-1" },
      title: "A paper"
    },
    revision: 2,
    rects: [{ height: 2, left: 12, top: 18, width: 36 }],
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...input
  };
}

const literature: LiteratureRecord = {
  authors: ["Author"],
  identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/example" }],
  literatureId: "lit_01J00000000000000000000000",
  provenance: { confirmedAt: "2026-08-10T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
  revision: 1,
  status: "confirmed",
  title: "A paper",
  year: 2026
};

describe("pdf annotation Intuecho sync", () => {
  test("publishes only a confirmed literatureId and a SHA-256 passage anchor", () => {
    const operation = createUpsertOperation(annotation({ note: "A reader's interpretation." }), literature);

    expect(operation).toMatchObject({
      body: "A reader's interpretation.",
      literatureId: literature.literatureId,
      operation: "upsert",
      revision: 2,
      sourcePassage: { page: 3, rects: [{ height: 2, left: 12, top: 18, width: 36 }] }
    });
    expect(operation.sourcePassage.anchorHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(operation).not.toHaveProperty("paperIdentity");
    expect(operation).not.toHaveProperty("literature");
  });

  test("retracts only a previously published remote annotation", () => {
    expect(createRetractOperation(annotation({
      publication: {
        remoteAnnotationId: "annotation-remote-1",
        sourceRevision: 1,
        state: "published",
        syncedAt: "2026-08-10T00:00:00.000Z"
      }
    }))).toMatchObject({
      operation: "retract",
      remoteAnnotationId: "annotation-remote-1",
      revision: 2
    });
  });
});
