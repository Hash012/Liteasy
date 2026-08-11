import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maximumBytes = 16 * 1024 * 1024;
const maximumPixels = 4_194_304;
const supportedColorTypes = new Map([[2, 3], [6, 4]]);

export async function generateRasterIllustration({
  objectStore,
  ocr,
  provider,
  signal,
  sourceIdentityHashes = [],
  spec
} = {}) {
  if (!provider || typeof provider.generateImage !== "function") throw new Error("raster_provider_invalid");
  validateRasterSpec(spec);
  throwIfAborted(signal);

  const providerPayload = rasterProviderPayload(spec);
  const image = await provider.generateImage({ payload: providerPayload, signal });
  return validateAndStoreRasterIllustration({
    image,
    objectStore,
    ocr,
    signal,
    sourceIdentityHashes,
    spec
  });
}

export async function validateAndStoreRasterIllustration({
  image,
  objectStore,
  ocr,
  signal,
  sourceIdentityHashes = [],
  spec
} = {}) {
  validateRasterSpec(spec);
  if (!objectStore || typeof objectStore.putImmutableObject !== "function") throw new Error("raster_object_store_invalid");
  if (!ocr || typeof ocr.recognize !== "function") throw new Error("raster_ocr_unavailable");
  throwIfAborted(signal);
  if (image?.mimeType !== "image/png") throw new Error("raster_mime_invalid");
  const bytes = providerBytes(image);
  const inspection = inspectPng(bytes, { allowTransparency: spec.styleLock.allowTransparency === true });
  if (inspection.width !== spec.composition.width || inspection.height !== spec.composition.height) {
    throw new Error("raster_dimensions_mismatch");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sourceIdentityHashes.includes(sha256)) throw new Error("raster_source_identity_collision");

  const recognized = await ocr.recognize(bytes, {
    labels: spec.labels.map(({ text }) => text),
    signal
  });
  throwIfAborted(signal);
  const verifiedLabelIds = verifyOcrLabels(spec.labels, recognized?.text ?? recognized);
  const stored = await objectStore.putImmutableObject(bytes, {
    contentHash: sha256,
    maximumBytes,
    mediaType: "image/png",
    metadata: {
      "asset-kind": "generated-raster",
      "label-verification": createHash("sha256").update(JSON.stringify(verifiedLabelIds)).digest("hex")
    }
  });
  if (stored?.contentHash !== sha256 || stored?.byteLength !== bytes.length || stored?.mediaType !== "image/png") {
    throw new Error("raster_storage_integrity_failed");
  }
  return {
    assetRef: `raster:${sha256}`,
    byteLength: bytes.length,
    height: inspection.height,
    labelVerification: {
      engine: normalizedEngine(ocr.engine),
      verifiedLabelIds
    },
    mimeType: "image/png",
    sha256,
    width: inspection.width
  };
}

export function rasterProviderPayload(spec) {
  validateRasterSpec(spec);
  const labels = spec.labels.map(({ text }) => text);
  return Object.freeze({
    height: spec.composition.height,
    prompt: [
      "Create one precise scientific or explanatory illustration from this typed visual specification.",
      `Visual schema: ${spec.visualSchema}`,
      `Required visible labels, reproduced exactly: ${JSON.stringify(labels)}`,
      `Palette: ${spec.styleLock.palette.join(", ")}`,
      `Typography: ${spec.styleLock.typography}`,
      "Do not add facts, labels, logos, watermarks, citations, decorative claims, or source-document facsimiles."
    ].join("\n"),
    width: spec.composition.width
  });
}

export function inspectPng(input, { allowTransparency = false } = {}) {
  const bytes = Buffer.from(input ?? []);
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new Error("raster_byte_limit");
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(pngSignature)) throw new Error("raster_png_invalid");
  let offset = 8;
  let ihdr;
  let seenIend = false;
  const idat = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("raster_png_invalid");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (!/^[A-Za-z]{4}$/.test(type) || dataEnd + 4 > bytes.length) throw new Error("raster_png_invalid");
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) throw new Error("raster_png_crc_invalid");
    const data = bytes.subarray(dataStart, dataEnd);
    if (!ihdr && type !== "IHDR") throw new Error("raster_png_invalid");
    if (type === "IHDR") {
      if (ihdr || length !== 13) throw new Error("raster_png_invalid");
      ihdr = {
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        height: data.readUInt32BE(4),
        interlace: data[12],
        width: data.readUInt32BE(0)
      };
    } else if (type === "IDAT") {
      if (seenIend) throw new Error("raster_png_invalid");
      idat.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || seenIend) throw new Error("raster_png_invalid");
      seenIend = true;
    } else if (type === "tRNS") {
      if (!allowTransparency) throw new Error("raster_transparency_forbidden");
    }
    offset = dataEnd + 4;
    if (seenIend) break;
  }
  if (!ihdr || !seenIend || offset !== bytes.length || idat.length === 0 || ihdr.width < 1 || ihdr.height < 1 ||
    ihdr.width * ihdr.height > maximumPixels || ihdr.bitDepth !== 8 || !supportedColorTypes.has(ihdr.colorType) ||
    ihdr.compression !== 0 || ihdr.filter !== 0 || ihdr.interlace !== 0) {
    throw new Error("raster_png_unsupported");
  }
  const channels = supportedColorTypes.get(ihdr.colorType);
  const rowBytes = ihdr.width * channels;
  const expectedInflatedBytes = (rowBytes + 1) * ihdr.height;
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflatedBytes });
  } catch {
    throw new Error("raster_png_decode_failed");
  }
  if (inflated.length !== expectedInflatedBytes) throw new Error("raster_png_decode_failed");
  const decoded = unfilterScanlines(inflated, ihdr.height, rowBytes, channels);
  if (!allowTransparency && ihdr.colorType === 6) {
    for (let index = 3; index < decoded.length; index += channels) {
      if (decoded[index] !== 255) throw new Error("raster_transparency_forbidden");
    }
  }
  return Object.freeze({
    hasAlphaChannel: ihdr.colorType === 6,
    height: ihdr.height,
    mimeType: "image/png",
    width: ihdr.width
  });
}

function validateRasterSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec) || typeof spec.visualSchema !== "string" ||
    !spec.visualSchema.trim() || spec.visualSchema.length > 10_000 || /(?:https?:|<script|foreignObject|data:|file:)/iu.test(spec.visualSchema)) {
    throw new Error("raster_visual_schema_invalid");
  }
  const composition = spec.composition;
  if (!composition || !Number.isSafeInteger(composition.width) || !Number.isSafeInteger(composition.height) ||
    composition.width < 1 || composition.height < 1 || composition.width > 4096 || composition.height > 4096 ||
    composition.width * composition.height > maximumPixels || !Number.isFinite(composition.aspectRatio) ||
    Math.abs(composition.width / composition.height - composition.aspectRatio) > 1e-6) {
    throw new Error("raster_dimensions_invalid");
  }
  if (!Array.isArray(spec.evidenceClaimIds) || spec.evidenceClaimIds.length === 0 || !Array.isArray(spec.labels) ||
    spec.labels.length === 0 || spec.labels.length > 64 || spec.labels.some((label) => (
      !label || typeof label.id !== "string" || typeof label.text !== "string" || !label.text.trim() || label.text.length > 160 ||
      !Array.isArray(label.evidenceClaimIds) || label.evidenceClaimIds.length === 0
    ))) {
    throw new Error("raster_evidence_missing");
  }
  if (new Set(spec.labels.map(({ id }) => id)).size !== spec.labels.length) throw new Error("raster_label_duplicate");
  if (!spec.styleLock || spec.styleLock.prohibitDecorativeClaims !== true || !Array.isArray(spec.styleLock.palette) ||
    spec.styleLock.palette.length === 0 || typeof spec.styleLock.typography !== "string" || !spec.styleLock.typography.trim()) {
    throw new Error("raster_style_lock_invalid");
  }
}

function providerBytes(image) {
  let bytes;
  if (image?.bytes instanceof Uint8Array) bytes = Buffer.from(image.bytes);
  else if (typeof image?.data === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) bytes = Buffer.from(image.data, "base64");
  else throw new Error("raster_provider_response_invalid");
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new Error("raster_byte_limit");
  return bytes;
}

function verifyOcrLabels(labels, recognizedText) {
  if (typeof recognizedText !== "string" || !recognizedText.trim()) throw new Error("raster_ocr_failed");
  const normalizedText = normalizeOcrText(recognizedText);
  const verified = labels.filter((label) => normalizedText.includes(normalizeOcrText(label.text))).map((label) => label.id);
  if (verified.length !== labels.length) throw new Error("raster_ocr_label_mismatch");
  return verified;
}

function normalizeOcrText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedEngine(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,120}$/.test(value) ? value : "ocr-v1";
}

function unfilterScanlines(inflated, height, rowBytes, bytesPerPixel) {
  const output = Buffer.alloc(rowBytes * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    if (filter > 4) throw new Error("raster_png_decode_failed");
    const rowOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[inputOffset + column];
      const left = column >= bytesPerPixel ? output[rowOffset + column - bytesPerPixel] : 0;
      const above = row > 0 ? output[rowOffset + column - rowBytes] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel ? output[rowOffset + column - rowBytes - bytesPerPixel] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      output[rowOffset + column] = (raw + predictor) & 0xff;
    }
    inputOffset += rowBytes;
  }
  return output;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left
    : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("raster_generation_cancelled");
}
