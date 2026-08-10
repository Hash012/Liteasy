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
      role: "confirmable",
      source: "public_registry",
      value: "10.1000/example"
    }],
    literatureId: "literature-1",
    provenance: {
      confirmedAt: "2026-08-09T10:00:00.000Z",
      mode: "public_registry",
      provider: "crossref"
    },
    revision: 1,
    status: "confirmed",
    title: "A Durable Literature Record",
    year: 2026,
    ...overrides
  };
}

describe("literatureRecord", () => {
  test("normalizes a valid versioned snapshot without losing provenance", () => {
    const snapshot = normalizeLiteratureSnapshot({
      literature: fixtureLiterature(),
      version: 1
    });

    expect(snapshot).toEqual({
      literature: expect.objectContaining({
        identifiers: [{ kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/example" }],
        provenance: {
          confirmedAt: "2026-08-09T10:00:00.000Z",
          mode: "public_registry",
          provider: "crossref"
        },
        revision: 1,
        status: "confirmed"
      }),
      version: 1
    });
  });

  test("upgrades a compatibility snapshot that predates explicit identifier roles", () => {
    const snapshot = normalizeLiteratureSnapshot({
      literature: {
        ...fixtureLiterature(),
        identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/example" }]
      },
      version: 1
    });

    expect(snapshot.literature.identifiers[0]).toMatchObject({
      kind: "doi",
      role: "confirmable",
      source: "public_registry"
    });
  });

  test.each([
    null,
    { literature: fixtureLiterature(), version: 2 },
    { literature: fixtureLiterature({ identifiers: [] }), version: 1 },
    {
      literature: {
        ...fixtureLiterature(),
        identifiers: [{
          kind: "doi",
          role: "confirmable",
          source: "public_registry",
          unexpected: true,
          value: "10.1000/unexpected"
        }]
      },
      version: 1
    },
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

  test("adapts a confirmed public identifier into a primary PaperIdentity", () => {
    const literature = fixtureLiterature();

    const identity = paperIdentityFromLiterature({ id: "paper-1", title: "Paper" }, literature);

    expect(identity.primary).toMatchObject({
      kind: "doi",
      source: "public_registry",
      value: "10.1000/example"
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

  test("keeps a confirmed OpenAlex work as a stable paper identity", () => {
    const literature = fixtureLiterature({
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
      provenance: {
        confirmedAt: "2026-08-09T10:00:00.000Z",
        mode: "public_registry",
        provider: "openalex"
      }
    });

    expect(paperIdentityFromLiterature({ id: "paper-1", title: "Paper" }, literature).primary)
      .toMatchObject({ kind: "openalex_id", value: "W123" });
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

  test("extracts all seven HelioX authors and a bounded PMLR hint", () => {
    const hints = createPdfLiteratureHints(
      { id: "heliox", title: "HelioX: A GPU-Native Framework for Simulation and Training of Biophysically Detailed Networks" },
      {
        embeddedMetadata: {
          authors: "Junfeng Lu, Zijie Yu, Shaoyang Cui, Gan He, Ruiqin Xiong, Kai Du, Tiejun Huang",
          title: "HelioX: A GPU-Native Framework for Simulation and Training of Biophysically Detailed Networks",
          year: 2026
        },
        firstPageText: "Proceedings of the 43rd International Conference on Machine Learning PMLR 306, 2026."
      }
    );

    expect(hints.authors).toEqual([
      "Junfeng Lu",
      "Zijie Yu",
      "Shaoyang Cui",
      "Gan He",
      "Ruiqin Xiong",
      "Kai Du",
      "Tiejun Huang"
    ]);
    expect(hints.pmlr).toEqual({ source: "pmlr", volume: 306, year: 2026 });
  });

  test("preserves family-given pairs while handling multilingual author delimiters", () => {
    expect(createPdfLiteratureHints(
      { id: "paper-comma", title: "A Paper" },
      { embeddedMetadata: { authors: "Ada Lovelace, Grace Hopper" } }
    ).authors).toEqual(["Ada Lovelace", "Grace Hopper"]);

    expect(createPdfLiteratureHints(
      { id: "paper-2", title: "A Paper" },
      { embeddedMetadata: { authors: "Lovelace, Ada; Hopper, Grace" } }
    ).authors).toEqual(["Lovelace, Ada", "Hopper, Grace"]);

    expect(createPdfLiteratureHints(
      { id: "paper-3", title: "A Paper" },
      { embeddedMetadata: { authors: "Ada Lovelace and Grace Hopper；李四、王五\n赵六" } }
    ).authors).toEqual(["Ada Lovelace", "Grace Hopper", "李四", "王五", "赵六"]);
  });
});
