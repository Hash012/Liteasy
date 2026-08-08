import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { createExternalPdfGrantRepository } from "./externalPdfGrantRepository.mjs";

test("external PDF grants are bound to owner and source and expire", () => {
  const database = createDatabase({ databasePath: ":memory:" });
  let now = new Date("2026-08-07T00:00:00.000Z");
  try {
    const repository = createExternalPdfGrantRepository(database, {
      grantLifetimeMs: 15 * 60 * 1000,
      now: () => now
    });
    const issued = repository.issue("user:alice", {
      sourceId: "reading-candidate:crossref:10.1000/example",
      sourceUrl: "https://papers.example.test/example.pdf#page=2"
    });

    assert.match(issued.grantId, /^pdfgrant_[A-Za-z0-9-]+$/);
    assert.equal(issued.sourceUrl, "https://papers.example.test/example.pdf");
    assert.deepEqual(repository.load("user:alice", {
      grantId: issued.grantId,
      sourceId: issued.sourceId
    }), {
      sourceId: issued.sourceId,
      sourceUrl: "https://papers.example.test/example.pdf"
    });
    assert.equal(repository.load("user:bob", {
      grantId: issued.grantId,
      sourceId: issued.sourceId
    }), null);
    assert.equal(repository.load("user:alice", {
      grantId: issued.grantId,
      sourceId: "reading-candidate:crossref:10.1000/other"
    }), null);

    now = new Date("2026-08-07T00:15:00.001Z");
    assert.equal(repository.load("user:alice", {
      grantId: issued.grantId,
      sourceId: issued.sourceId
    }), null);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM external_pdf_grants").get().count, 0);
  } finally {
    database.close();
  }
});

test("external PDF grants reject non-HTTPS and credential-bearing URLs", () => {
  const database = createDatabase({ databasePath: ":memory:" });
  try {
    const repository = createExternalPdfGrantRepository(database);
    assert.throws(() => repository.issue("user:alice", {
      sourceId: "source-1",
      sourceUrl: "http://papers.example.test/example.pdf"
    }), /external_pdf_source_url_invalid/);
    assert.throws(() => repository.issue("user:alice", {
      sourceId: "source-1",
      sourceUrl: "https://user:password@papers.example.test/example.pdf"
    }), /external_pdf_source_url_invalid/);
  } finally {
    database.close();
  }
});
