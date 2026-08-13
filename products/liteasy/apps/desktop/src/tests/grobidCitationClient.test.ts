import { describe, expect, test, vi } from "vitest";

import {
  buildGrobidAnchorLocalReferenceIndex,
  createGrobidCitationClient,
  parseGrobidCitationTei
} from "../app/features/pdf/grobidCitationClient";

const tei = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body>
      <p>Self-attention follows prior work <ref type="bibr" target="#b0" coords="1,10,10,8,8">[1]</ref>.</p>
      <p>Field theory is discussed by <ref type="bibr" target="#b1" coords="2,10,10,8,8">Bourdieu (1984)</ref>.</p>
    </body>
    <back><listBibl>
      <biblStruct xml:id="b0"><analytic><title>Attention-based translation</title></analytic></biblStruct>
      <biblStruct xml:id="b1"><monogr><title>Distinction</title><author>Bourdieu</author><date when="1984" /></monogr></biblStruct>
    </listBibl></back>
  </text>
</TEI>`;

describe("grobidCitationClient", () => {
  test("maps TEI bibliography targets back into PDF page offsets", () => {
    const parsed = parseGrobidCitationTei(tei, {
      1: "Self-attention follows prior work [1].",
      2: "Field theory is discussed by Bourdieu (1984)."
    });

    expect(parsed.references).toEqual([
      { number: 1, text: "Attention-based translation" },
      { number: 2, text: "Distinction Bourdieu 1984" }
    ]);
    expect(parsed.markers).toEqual([
      expect.objectContaining({ numbers: [1], page: 1, start: 34 }),
      expect.objectContaining({ numbers: [2], page: 2 })
    ]);
  });

  test("reuses anchor-local attribution instead of creating a second citation graph", () => {
    const parsed = parseGrobidCitationTei(tei, {
      1: "Self-attention follows prior work [1].",
      2: "Field theory is discussed by Bourdieu (1984)."
    });
    const references = buildGrobidAnchorLocalReferenceIndex({
      anchors: [{ id: "self-attention", page: 1, sourceEnd: 14, sourceStart: 0 }],
      pageTexts: { 1: "Self-attention follows prior work [1]." },
      snapshot: {
        contentFingerprint: "a".repeat(64),
        parser: "grobid",
        parserVersion: 1,
        ...parsed
      }
    });

    expect(references[0].references[0]).toMatchObject({
      evidence: expect.stringContaining("本文参考文献 [1]"),
      number: 1,
      text: "Attention-based translation"
    });
  });

  test("uploads PDF bytes without JSON/base64 and returns a versioned structure", async () => {
    const transport = vi.fn(async (request) => ({
      json: async () => ({
        contentFingerprint: "a".repeat(64),
        parser: "grobid",
        parserVersion: 1,
        reused: false,
        tei
      }),
      ok: true,
      status: 200
    }));
    const client = createGrobidCitationClient({
      accessToken: "desktop-access-token",
      endpoint: "https://cloud.example.com/",
      transport
    });
    const result = await client({
      pageTexts: { 1: "Prior work [1].", 2: "Bourdieu (1984)." },
      pdfBytes: new TextEncoder().encode("%PDF-1.7 fixture")
    });

    expect(result).toMatchObject({ contentFingerprint: "a".repeat(64), parser: "grobid", parserVersion: 1 });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        Authorization: "Bearer desktop-access-token",
        "Content-Type": "application/pdf"
      },
      method: "POST",
      url: "https://cloud.example.com/v1/research/parse-pdf"
    }));
    const body = transport.mock.calls[0][0].body;
    expect(Object.prototype.toString.call(body)).toBe("[object ArrayBuffer]");
    expect(new TextDecoder().decode(new Uint8Array(body))).toBe("%PDF-1.7 fixture");
  });

  test("refuses to construct an anonymous PDF upload", async () => {
    const transport = vi.fn();
    const client = createGrobidCitationClient({ endpoint: "https://cloud.example.com", transport });
    await expect(client({
      pageTexts: {},
      pdfBytes: new TextEncoder().encode("%PDF-private")
    })).rejects.toThrow("请先登录 Liteasy 账号");
    expect(transport).not.toHaveBeenCalled();
  });
});
