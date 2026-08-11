import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  generateRasterIllustration,
  inspectPng,
  rasterProviderPayload
} from "./visualizationRasterService.mjs";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function validPngBytes({ alpha = 255, height = 2, width = 2 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4, 255);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) row[1 + x * 4 + 3] = alpha;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function rasterFixture() {
  return {
    composition: { aspectRatio: 1, height: 2, width: 2 },
    evidenceClaimIds: ["claim-raster"],
    labels: [{ evidenceClaimIds: ["claim-raster"], id: "label-1", text: "cell" }],
    styleLock: { palette: ["#ffffff", "#111827"], prohibitDecorativeClaims: true, typography: "system" },
    visualSchema: "simple labelled cell diagram"
  };
}

function imageAdapter(image, calls) {
  return {
    async generateImage(input) {
      calls?.push(input);
      return image;
    }
  };
}

function objectStore(calls) {
  return {
    async putImmutableObject(bytes, options) {
      calls.push({ bytes: Buffer.from(bytes), options });
      return {
        byteLength: bytes.length,
        contentHash: options.contentHash,
        mediaType: options.mediaType,
        storageKey: `objects/${options.contentHash}`
      };
    }
  };
}

test("generates from a typed projection, verifies OCR, and stores immutable PNG bytes", async () => {
  const bytes = validPngBytes();
  const providerCalls = [];
  const storageCalls = [];
  const result = await generateRasterIllustration({
    objectStore: objectStore(storageCalls),
    ocr: { engine: "fixture-ocr/v1", async recognize() { return { text: "CELL" }; } },
    provider: imageAdapter({ bytes, mimeType: "image/png", providerRequestId: "secret" }, providerCalls),
    spec: rasterFixture()
  });

  assert.deepEqual(Object.keys(result), ["assetRef", "byteLength", "height", "labelVerification", "mimeType", "sha256", "width"]);
  assert.equal(result.assetRef, `raster:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.deepEqual(result.labelVerification, { engine: "fixture-ocr/v1", verifiedLabelIds: ["label-1"] });
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].payload.prompt.includes("claim-raster"), false);
  assert.equal(providerCalls[0].payload.prompt.includes("cell"), true);
  assert.equal(storageCalls.length, 1);
  assert.equal(storageCalls[0].options.mediaType, "image/png");
});

test("fully decodes PNG scanlines and enforces the transparency policy", () => {
  assert.deepEqual(inspectPng(validPngBytes()), {
    hasAlphaChannel: true,
    height: 2,
    mimeType: "image/png",
    width: 2
  });
  assert.throws(() => inspectPng(validPngBytes({ alpha: 120 })), /raster_transparency_forbidden/);
  assert.equal(inspectPng(validPngBytes({ alpha: 120 }), { allowTransparency: true }).width, 2);
  const corrupt = validPngBytes();
  corrupt[32] ^= 1;
  assert.throws(() => inspectPng(corrupt), /raster_png_crc_invalid/);
});

test("fails closed on OCR mismatch, source identity collision, and cancellation", async () => {
  const bytes = validPngBytes();
  const input = {
    objectStore: objectStore([]),
    ocr: { async recognize() { return { text: "unrelated" }; } },
    provider: imageAdapter({ bytes, mimeType: "image/png" }),
    spec: rasterFixture()
  };
  await assert.rejects(() => generateRasterIllustration(input), /raster_ocr_label_mismatch/);
  await assert.rejects(() => generateRasterIllustration({
    ...input,
    ocr: { async recognize() { return { text: "cell" }; } },
    sourceIdentityHashes: [createHash("sha256").update(bytes).digest("hex")]
  }), /raster_source_identity_collision/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => generateRasterIllustration({ ...input, signal: controller.signal }), /raster_generation_cancelled/);
});

test("provider payload contains only bounded image-generation fields", () => {
  assert.deepEqual(Object.keys(rasterProviderPayload(rasterFixture())), ["height", "prompt", "width"]);
});
