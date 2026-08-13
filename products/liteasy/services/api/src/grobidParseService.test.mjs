import assert from "node:assert/strict";
import test from "node:test";
import { GrobidParseError, GrobidParseService } from "./grobidParseService.mjs";

function repository(cached) {
  const calls = [];
  return {
    calls,
    async get(fingerprint) {
      calls.push({ get: fingerprint });
      return cached;
    },
    async recordReuse(input) {
      calls.push({ reuse: input });
    },
    async save(input) {
      calls.push({ save: input });
      return {
        contentFingerprint: input.contentFingerprint,
        parserVersion: input.parserVersion,
        tei: input.tei
      };
    }
  };
}

const pdf = Buffer.from("%PDF-1.7 fixture");
const tei = "<TEI><text><body /></text></TEI>";
const context = { subjectId: "user-1", traceId: "trace-1" };

test("reuses a versioned TEI cache without sending PDF bytes upstream", async () => {
  const cached = { contentFingerprint: "a".repeat(64), parserVersion: 1, tei };
  const store = repository(cached);
  let fetched = false;
  const service = new GrobidParseService({
    endpoint: "http://grobid:8070",
    fetchImpl: async () => { fetched = true; },
    repository: store
  });

  const result = await service.parse(pdf, context);
  assert.equal(result.reused, true);
  assert.equal(fetched, false);
  assert.equal(store.calls.some((call) => call.reuse?.subjectId === "user-1"), true);
});

test("sends a bounded PDF as multipart and persists only its hash and TEI", async () => {
  const store = repository();
  let form;
  const service = new GrobidParseService({
    endpoint: "http://grobid:8070",
    fetchImpl: async (_url, init) => {
      form = init.body;
      return new Response(tei, { status: 200 });
    },
    repository: store
  });

  const result = await service.parse(pdf, context);
  assert.equal(result.reused, false);
  assert.deepEqual(form.getAll("teiCoordinates"), ["ref", "biblStruct", "note"]);
    assert.equal(form.get("consolidateCitations"), "0");
  const save = store.calls.find((call) => call.save)?.save;
  assert.equal(save.tei, tei);
  assert.equal("pdfBytes" in save, false);
  assert.equal(save.contentFingerprint.length, 64);
});

test("deduplicates concurrent parsing for the same PDF fingerprint", async () => {
  const store = repository();
  let fetches = 0;
  const service = new GrobidParseService({
    endpoint: "http://grobid:8070",
    fetchImpl: async () => {
      fetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(tei, { status: 200 });
    },
    repository: store
  });

  await Promise.all([
    service.parse(pdf, { subjectId: "user-1", traceId: "trace-1" }),
    service.parse(pdf, { subjectId: "user-2", traceId: "trace-2" })
  ]);
  assert.equal(fetches, 1);
});

test("rejects invalid or oversized PDF content before contacting GROBID", async () => {
  const service = new GrobidParseService({
    endpoint: "http://grobid:8070",
    fetchImpl: async () => assert.fail("must not fetch"),
    maximumPdfBytes: 8,
    repository: repository()
  });
  for (const bytes of [Buffer.from("not-pdf"), pdf]) {
    await assert.rejects(() => service.parse(bytes, context), (error) => {
      assert.equal(error instanceof GrobidParseError, true);
      assert.equal(error.code, "grobid_pdf_invalid");
      return true;
    });
  }
});
