import { describe, expect, test } from "vitest";
import {
  inferPaperIdentityMetadataFromPdfText,
  resolvePaperIdentity,
  resolvePaperIdentityMap
} from "../app/features/paper-identity/paperIdentity";

describe("paperIdentity", () => {
  test("extracts only explicitly marked DOI and arXiv identifiers from PDF text", () => {
    expect(inferPaperIdentityMetadataFromPdfText(
      "Preprint arXiv: 1706.03762v5. DOI: https://doi.org/10.48550/arXiv.1706.03762"
    )).toEqual({
      arxivId: "1706.03762v5",
      doi: "10.48550/arxiv.1706.03762"
    });
    expect(inferPaperIdentityMetadataFromPdfText("The experiment ran in 2020.12345 seconds.")).toEqual({});
  });

  test("prefers DOI over every weaker paper identity", () => {
    const identity = resolvePaperIdentity({
      arxivId: "2301.01234",
      doi: "https://doi.org/10.1145/1234567.8901234",
      id: "local-paper",
      semanticScholarId: "0123456789abcdef0123456789abcdef01234567",
      title: "A Paper With Many Identifiers"
    });

    expect(identity.primary).toMatchObject({
      kind: "doi",
      role: "confirmable_hint",
      source: "metadata",
      value: "10.1145/1234567.8901234"
    });
    expect(identity.candidates.map((candidate) => candidate.kind)).toEqual([
      "doi",
      "arxiv_id",
      "semantic_scholar_id",
      "local_paper_id"
    ]);
  });

  test("falls through arXiv, Semantic Scholar, title hash, then local paper id", () => {
    expect(resolvePaperIdentity({
      arxivId: "arXiv:2402.01234v2",
      id: "paper-arxiv",
      title: "Arxiv Paper"
    }).primary).toMatchObject({
      kind: "arxiv_id",
      value: "2402.01234v2"
    });

    expect(resolvePaperIdentity({
      id: "paper-semantic",
      semanticScholarId: "CorpusID: 123456",
      title: "Semantic Scholar Paper"
    }).primary).toMatchObject({
      kind: "semantic_scholar_id",
      value: "corpus:123456"
    });

    expect(resolvePaperIdentity({
      authors: ["Alice Zhang", "Bob Smith"],
      id: "paper-hash",
      title: "Stable Title",
      year: 2026
    }).primary).toMatchObject({ kind: "title_authors_year_hash", role: "candidate_alias" });

    expect(resolvePaperIdentity({
      id: "paper-local",
      title: "Local Only"
    }).primary).toMatchObject({
      kind: "local_paper_id",
      value: "paper-local"
    });
  });

  test("extracts DOI and arXiv ids from visible title or source path when metadata is absent", () => {
    expect(resolvePaperIdentity({
      id: "paper-doi-path",
      sourcePath: "/papers/10.48550/arXiv.2401.11111.pdf",
      title: "Replication Package DOI 10.48550/arXiv.2401.11111"
    }).primary).toMatchObject({
      kind: "doi",
      source: "inferred",
      value: "10.48550/arxiv.2401.11111"
    });

    expect(resolvePaperIdentity({
      id: "paper-arxiv-path",
      sourcePath: "/papers/arxiv/2401.11111v1.pdf",
      title: "No DOI Here"
    }).primary).toMatchObject({
      kind: "arxiv_id",
      source: "inferred",
      value: "2401.11111v1"
    });
  });

  test("builds a stable identity map keyed by local paper id", () => {
    const map = resolvePaperIdentityMap([
      { doi: "10.1000/demo", id: "paper-1", title: "Paper 1" },
      { id: "paper-2", title: "Paper 2" }
    ]);

    expect(map["paper-1"].primary.kind).toBe("doi");
    expect(map["paper-2"].primary.kind).toBe("local_paper_id");
  });
});
