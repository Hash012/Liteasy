import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  isPublicNetworkAddress,
  SecureExternalPdfDownloader
} from "./secureExternalPdfDownloader.mjs";

const config = { contactEmail: "research@example.test", maximumBytes: 1024, timeoutMs: 1000 };

function response(status, headers, bytes = []) {
  return { body: Readable.from(bytes), headers, status };
}

test("classifies public and non-public network destinations", () => {
  assert.equal(isPublicNetworkAddress("8.8.8.8"), true);
  assert.equal(isPublicNetworkAddress("10.0.0.1"), false);
  assert.equal(isPublicNetworkAddress("169.254.169.254"), false);
  assert.equal(isPublicNetworkAddress("2001:4860:4860::8888"), true);
  assert.equal(isPublicNetworkAddress("2001:db8::1"), false);
  assert.equal(isPublicNetworkAddress("::ffff:127.0.0.1"), false);
});

test("pins a public DNS result and validates MIME, header, length, and hash", async () => {
  const calls = [];
  const downloader = new SecureExternalPdfDownloader(config, {
    resolveAddress: async () => ({ address: "8.8.8.8", family: 4 }),
    request: async (url, address) => {
      calls.push({ address, url: String(url) });
      return response(200, { "content-type": "application/pdf" }, [Buffer.from("%PDF-valid")]);
    }
  });
  const result = await downloader.download("https://papers.example/document.pdf");
  assert.equal(result.bytes.toString(), "%PDF-valid");
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls[0].address, { address: "8.8.8.8", family: 4 });
});

test("rejects private DNS answers and redirects before fetching their bodies", async () => {
  let requested = 0;
  const privateDownloader = new SecureExternalPdfDownloader(config, {
    resolveAddress: async () => ({ address: "127.0.0.1", family: 4 }),
    request: async () => { requested += 1; }
  });
  await assert.rejects(() => privateDownloader.download("https://papers.example/document.pdf"), /external_pdf_network_forbidden/);
  assert.equal(requested, 0);

  const redirectDownloader = new SecureExternalPdfDownloader(config, {
    resolveAddress: async (hostname) => hostname === "papers.example"
      ? { address: "8.8.8.8", family: 4 }
      : { address: "10.0.0.1", family: 4 },
    request: async () => response(302, { location: "https://internal.example/metadata" })
  });
  await assert.rejects(() => redirectDownloader.download("https://papers.example/document.pdf"), /external_pdf_network_forbidden/);
});

test("rejects a non-PDF body even when the upstream declares PDF", async () => {
  const downloader = new SecureExternalPdfDownloader(config, {
    resolveAddress: async () => ({ address: "8.8.8.8", family: 4 }),
    request: async () => response(200, { "content-type": "application/pdf" }, [Buffer.from("<html>login</html>")])
  });
  await assert.rejects(() => downloader.download("https://papers.example/document.pdf"), /external_pdf_header_invalid/);
});
