import { describe, expect, test } from "vitest";
import {
  createLiteratureCitationExport,
  formatLiteratureBibtex,
  groupLiteratureCandidates,
  literatureRecordUrl,
  literatureVersionOpenTarget,
  preferredCitationLiterature
} from "../app/features/forum/literatureVersioning";
import type {
  LiteratureCandidate,
  LiteratureRecord,
  LiteratureVersionRelation
} from "../app/features/paper-identity/literature.types";

function record(input: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234" }],
    literatureId: "literature-preprint",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "arxiv" },
    revision: 1,
    status: "confirmed",
    title: "A Versioned Work",
    year: 2026,
    ...input
  };
}

describe("literatureVersioning", () => {
  test("groups candidates connected by an evidenced version relation", () => {
    const candidates: LiteratureCandidate[] = [{
      candidateKey: "arxiv:arxiv_id:2401.01234",
      provider: "arxiv",
      record: {
        authors: ["Ada Lovelace"],
        documentType: "preprint",
        identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234" }],
        title: "A Versioned Work",
        year: 2026
      },
      relations: [{
        direction: "from_current",
        evidence: { sourceField: "arxiv:doi" },
        relationType: "is_preprint_of",
        targetIdentifier: { kind: "doi", value: "10.1000/published" }
      }]
    }, {
      candidateKey: "crossref:doi:10.1000/published",
      provider: "crossref",
      record: {
        authors: ["Ada Lovelace"],
        documentType: "journal-article",
        identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/published" }],
        title: "A Versioned Work",
        year: 2026
      }
    }];

    const groups = groupLiteratureCandidates(candidates);

    expect(groups).toHaveLength(1);
    expect(groups[0].candidates.map((candidate) => candidate.candidateKey)).toEqual([
      "arxiv:arxiv_id:2401.01234",
      "crossref:doi:10.1000/published"
    ]);
    expect(groups[0].versioned).toBe(true);
  });

  test("prefers the evidenced published version for citation export", () => {
    const current = record();
    const publication = record({
      documentType: "journal-article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/published" }],
      literatureId: "literature-publication",
      provenance: { confirmedAt: "2026-08-10T00:00:00.000Z", mode: "public_registry", provider: "crossref" }
    });
    const versions: LiteratureVersionRelation[] = [{
      direction: "from_current",
      literature: publication,
      relation: {
        createdAt: "2026-08-10T00:00:00.000Z",
        evidence: { sourceField: "arxiv:doi" },
        fromLiteratureId: current.literatureId,
        provider: "arxiv",
        relationType: "is_preprint_of",
        toLiteratureId: publication.literatureId,
        verificationStatus: "confirmed"
      }
    }];

    expect(preferredCitationLiterature(current, versions).literatureId).toBe("literature-publication");
    expect(formatLiteratureBibtex(publication)).toContain("doi = {10.1000/published}");
    expect(createLiteratureCitationExport({
      current,
      format: "bibtex",
      versions
    })).toMatchObject({
      literature: { literatureId: "literature-publication" },
      text: expect.stringContaining("doi = {10.1000/published}")
    });
    expect(createLiteratureCitationExport({
      current,
      format: "citation",
      selectedLiteratureId: current.literatureId,
      versions
    }).literature.literatureId).toBe(current.literatureId);
  });

  test("opens a matching local version before falling back to its registry page", () => {
    const publication = record({
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/published" }],
      literatureId: "literature-publication"
    });

    expect(literatureVersionOpenTarget(publication, [{
      id: "paper-local-publication",
      literature: { literatureId: publication.literatureId }
    }])).toEqual({ kind: "local", paperId: "paper-local-publication" });
    expect(literatureVersionOpenTarget(publication, [])).toEqual({
      kind: "external",
      url: "https://doi.org/10.1000/published"
    });
  });

  test("opens official OpenReview, DBLP, and PMLR records when no DOI is available", () => {
    expect(literatureRecordUrl(record({
      identifiers: [{ kind: "openreview_id", source: "public_registry", value: "OR-ICLR-2026" }]
    }))).toBe("https://openreview.net/forum?id=OR-ICLR-2026");
    expect(literatureRecordUrl(record({
      identifiers: [{ kind: "dblp_key", source: "public_registry", value: "conf/aaai/Lovelace26" }]
    }))).toBe("https://dblp.org/rec/conf/aaai/Lovelace26");
    expect(literatureRecordUrl(record({
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/abad-rocamora24a" }]
    }))).toBe("https://proceedings.mlr.press/v235/abad-rocamora24a.html");
  });
});
