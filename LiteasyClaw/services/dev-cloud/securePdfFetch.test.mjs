import assert from "node:assert/strict";
import test from "node:test";
import { fetchSecurePdf, isPublicIpAddress } from "./securePdfFetch.mjs";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("classifies private, reserved, and public addresses for PDF SSRF protection", () => {
  assert.equal(isPublicIpAddress("127.0.0.1"), false);
  assert.equal(isPublicIpAddress("10.2.3.4"), false);
  assert.equal(isPublicIpAddress("169.254.169.254"), false);
  assert.equal(isPublicIpAddress("::1"), false);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
});

test("downloads a bounded PDF and records its final URL and content hash", async () => {
  const pdf = await fetchSecurePdf("https://papers.example.test/paper.pdf", {
    resolver: publicResolver,
    transport: async () => new Response(Buffer.from("%PDF-1.7\ntraceable"), {
      headers: { "content-type": "application/pdf" },
      status: 200
    })
  });
  assert.equal(pdf.finalUrl, "https://papers.example.test/paper.pdf");
  assert.equal(pdf.contentHash.length, 64);
  assert.equal(pdf.bytes.toString("ascii"), "%PDF-1.7\ntraceable");
});

test("rejects a PDF URL resolving to private infrastructure", async () => {
  await assert.rejects(
    fetchSecurePdf("https://papers.example.test/paper.pdf", {
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      transport: async () => { throw new Error("must not fetch"); }
    }),
    (error) => error.code === "pdf_url_not_public"
  );
  await assert.rejects(
    fetchSecurePdf("https://[::1]/paper.pdf", {
      resolver: async () => { throw new Error("IP literals must not use DNS"); },
      transport: async () => { throw new Error("must not fetch"); }
    }),
    (error) => error.code === "pdf_url_not_public"
  );
});

test("revalidates every PDF redirect target", async () => {
  await assert.rejects(
    fetchSecurePdf("https://papers.example.test/paper.pdf", {
      resolver: async (hostname) => [{
        address: hostname === "internal.example.test" ? "10.0.0.4" : "93.184.216.34",
        family: 4
      }],
      transport: async () => new Response(null, {
        headers: { location: "https://internal.example.test/secret" },
        status: 302
      })
    }),
    (error) => error.code === "pdf_url_not_public"
  );
});

test("rejects non-PDF bodies and responses over the byte limit", async () => {
  await assert.rejects(
    fetchSecurePdf("https://papers.example.test/not-pdf", {
      resolver: publicResolver,
      transport: async () => new Response("<html>login</html>", {
        headers: { "content-type": "text/html" },
        status: 200
      })
    }),
    (error) => error.code === "invalid_pdf_content"
  );
  await assert.rejects(
    fetchSecurePdf("https://papers.example.test/large.pdf", {
      maximumBytes: 8,
      resolver: publicResolver,
      transport: async () => new Response("%PDF-1.7 too large", { status: 200 })
    }),
    (error) => error.code === "pdf_too_large"
  );
});
