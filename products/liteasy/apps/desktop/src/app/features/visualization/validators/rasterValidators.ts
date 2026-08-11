import type { RasterIllustrationSpecV1 } from "../visualizationArtifact.types";

export type RasterDecodeResult = {
  hasTransparency: boolean;
  height: number;
  width: number;
};

export type RasterValidationInput = {
  bytes: Uint8Array;
  declaredSha256: string;
  decode?: (bytes: Uint8Array) => Promise<RasterDecodeResult>;
  mimeType?: string;
  sourceIdentityHashes?: readonly string[];
  spec: RasterIllustrationSpecV1;
};

export type RasterImageValidationResult = {
  height: number;
  mimeType: "image/png";
  sha256: string;
  width: number;
};

const maximumBytes = 16 * 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export async function validateRasterImage(input: RasterValidationInput): Promise<RasterImageValidationResult> {
  validateSpec(input.spec);
  if (input.mimeType !== undefined && input.mimeType !== "image/png") throw new Error("raster_mime_invalid");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > maximumBytes) throw new Error("raster_byte_limit");
  const text = new TextDecoder().decode(input.bytes.subarray(0, Math.min(input.bytes.byteLength, 2048)));
  if (/<script|foreignObject|href=["']https?:|src=["']https?:/iu.test(text)) throw new Error("raster_external_reference");
  const dimensions = pngDimensions(input.bytes);
  const sha256 = await sha256Hex(input.bytes);
  if (!input.declaredSha256 || input.declaredSha256 !== sha256) throw new Error("raster_digest_mismatch");
  if (input.sourceIdentityHashes?.includes(sha256)) throw new Error("raster_source_identity_collision");
  const asset = input.spec.asset;
  if (!asset || asset.sha256 !== sha256 || asset.assetRef !== `raster:${sha256}` || asset.byteLength !== input.bytes.byteLength ||
    asset.mimeType !== "image/png" || asset.width !== dimensions.width || asset.height !== dimensions.height) {
    throw new Error("raster_asset_metadata_invalid");
  }
  if (dimensions.width !== input.spec.composition.width || dimensions.height !== input.spec.composition.height) {
    throw new Error("raster_dimensions_mismatch");
  }
  const decoded = await (input.decode ?? decodeRasterImage)(input.bytes);
  if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new Error("raster_decode_dimensions_mismatch");
  if (decoded.hasTransparency && input.spec.styleLock.allowTransparency !== true) throw new Error("raster_transparency_forbidden");
  return {
    height: dimensions.height,
    mimeType: "image/png",
    sha256,
    width: dimensions.width
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes as unknown as BufferSource;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateSpec(spec: RasterIllustrationSpecV1): void {
  if (!Number.isSafeInteger(spec.composition.width) || !Number.isSafeInteger(spec.composition.height) ||
    spec.composition.width <= 0 || spec.composition.height <= 0 ||
    Math.abs(spec.composition.width / spec.composition.height - spec.composition.aspectRatio) > 1e-6) {
    throw new Error("raster_dimensions_invalid");
  }
  if (spec.evidenceClaimIds.length === 0 || spec.labels.length === 0 || spec.labels.some((label) => label.evidenceClaimIds.length === 0)) {
    throw new Error("raster_evidence_missing");
  }
  if (spec.styleLock.prohibitDecorativeClaims !== true) throw new Error("raster_style_lock_invalid");
  const verified = spec.asset?.labelVerification.verifiedLabelIds ?? [];
  if (verified.length !== spec.labels.length || spec.labels.some((label) => !verified.includes(label.id)) ||
    new Set(verified).size !== verified.length) {
    throw new Error("raster_ocr_label_mismatch");
  }
}

function pngDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length < 33 || pngSignature.some((value, index) => bytes[index] !== value) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") {
    throw new Error("raster_png_invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width < 1 || height < 1 || width * height > 4_194_304) throw new Error("raster_dimensions_invalid");
  return { height, width };
}

async function decodeRasterImage(bytes: Uint8Array): Promise<RasterDecodeResult> {
  if (typeof createImageBitmap !== "function") throw new Error("raster_decoder_unavailable");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  } catch {
    throw new Error("raster_png_decode_failed");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("raster_decoder_unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let hasTransparency = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 255) {
        hasTransparency = true;
        break;
      }
    }
    return { hasTransparency, height: bitmap.height, width: bitmap.width };
  } finally {
    bitmap.close();
  }
}
