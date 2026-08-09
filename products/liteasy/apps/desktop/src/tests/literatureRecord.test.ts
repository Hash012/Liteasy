import { describe, expect, test } from "vitest";

import {
  createPdfLiteratureHints,
  normalizeLiteratureSnapshot,
  paperIdentityFromLiterature
} from "../app/features/paper-identity/literatureRecord";
import type { LiteratureRecord } from "../app/features/paper-identity/literature.types";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

function fixtureLiterature(
  overrides: Partial<LiteratureRecord> = {}
): LiteratureRecord {
  return {
    authors: ["Ada Lovelace", "Grace Hopper"],
    identifiers: [{
      kind: "doi",
      source: "public_registry",
      value: "10.1000/example"
    }],
    literatureId: "literature-1",
    provenance: {
      confirmedAt: "2026-08-09T10:00:00.000Z",
      mode: "public_registry",
      provider: "crossref"
    },
    title: "A Durable Literature Record",
    year: 2026,
    ...overrides
  };
}

describe("literatureRecord", () => {
  test("normalizes a valid versioned snapshot without losing provenance", () => {
    const snapshot = normalizeLiteratureSnapshot({
      literature: fixtureLiterature({
        identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
        provenance: { confirmedAt: "2026-08-09T10:00:00.000Z", mode: "manual" }
      }),
      version: 1
    });

    expect(snapshot).toEqual({
      literature: expect.objectContaining({
        identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
        provenance: { confirmedAt: "2026-08-09T10:00:00.000Z", mode: "manual" }
      }),
      version: 1
    });
  });

  test.each([
    null,
    { literature: fixtureLiterature(), version: 2 },
    { literature: fixtureLiterature({ identifiers: [] }), version: 1 },
    {
      literature: fixtureLiterature({
        identifiers: [{ kind: "doi", source: "manual", value: "10.1000/mismatch" }]
      }),
      version: 1
    },
    { literature: fixtureLiterature({ title: "" }), version: 1 },
    {
      literature: fixtureLiterature({
        provenance: {
          confirmedAt: "not-a-date",
          mode: "public_registry",
          provider: "crossref"
        }
      }),
      version: 1
    }
  ])("rejects a malformed authoritative snapshot", (value) => {
    expect(() => normalizeLiteratureSnapshot(value)).toThrow("文献元数据快照无效");
  });

  test("preserves manual provenance while adapting a primary PaperIdentity", () => {
    const literature = fixtureLiterature({
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
      provenance: { confirmedAt: "2026-08-09T10:00:00.000Z", mode: "manual" }
    });

    const identity = paperIdentityFromLiterature({ id: "paper-1", title: "Paper" }, literature);

    expect(identity.primary).toMatchObject({
      kind: "doi",
      source: "manual",
      value: "10.1000/manual"
    });
  });

  test("uses stable identifier priority instead of provider result order", () => {
    const literature = fixtureLiterature({
      identifiers: [
        { kind: "arxiv_id", source: "public_registry", value: "2401.01234" },
        { kind: "doi", source: "public_registry", value: "10.1000/preferred" }
      ]
    });

    expect(paperIdentityFromLiterature({ id: "paper-1", title: "Paper" }, literature).primary)
      .toMatchObject({ kind: "doi", value: "10.1000/preferred" });
  });

  test("prefers confirmed literature over legacy flat paper identifiers", () => {
    const literature = fixtureLiterature({
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234" }]
    });

    expect(resolvePaperIdentity({
      doi: "10.1000/legacy",
      id: "paper-1",
      literature,
      title: "Paper"
    }).primary).toMatchObject({
      kind: "arxiv_id",
      source: "public_registry",
      value: "2401.01234"
    });
  });

  test("derives bounded resolver hints without forwarding first-page text", () => {
    const hints = createPdfLiteratureHints(
      { id: "paper-1", title: "Fallback title" },
      {
        embeddedMetadata: {
          authors: ["Ada Lovelace"],
          title: "Embedded title",
          year: 2024
        },
        firstPageText: [
          "Embedded title",
          "DOI: https://doi.org/10.1000/Bounded.Hint",
          "private first-page body that must never leave the desktop"
        ].join("\n")
      }
    );

    expect(hints).toEqual({
      authors: ["Ada Lovelace"],
      identifiers: [{ kind: "doi", value: "10.1000/bounded.hint" }],
      title: "Embedded title",
      year: 2024
    });
    expect(JSON.stringify(hints)).not.toContain("private first-page body");
  });
});
