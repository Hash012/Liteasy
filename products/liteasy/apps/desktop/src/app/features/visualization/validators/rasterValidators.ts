import type { RasterIllustrationSpecV1 } from "../visualizationArtifact.types";

export type RasterValidationInput = {
  bytes: Uint8Array;
  declaredSha256: string;
  spec: RasterIllustrationSpecV1;
};

export type RasterImageValidationResult = {
  height: number;
  mimeType: "image/png";
  sha256: string;
  width: number;
};

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export async function validateRasterImage(input: RasterValidationInput): Promise<RasterImageValidationResult> {
  validateSpec(input.spec);
  const text = new TextDecoder().decode(input.bytes);
  if (/<script|foreignObject|href=["']https?:|src=["']https?:/iu.test(text)) throw new Error("raster_external_reference");
  const sha256 = await sha256Hex(input.bytes);
  if (input.declaredSha256 && input.declaredSha256 !== sha256) throw new Error("raster_digest_mismatch");
  const dimensions = pngDimensions(input.bytes);
  if (dimensions.width !== input.spec.composition.width || dimensions.height !== input.spec.composition.height) {
    throw new Error("raster_dimensions_mismatch");
  }
  return {
    height: dimensions.height,
    mimeType: "image/png",
    sha256,
    width: dimensions.width
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateSpec(spec: RasterIllustrationSpecV1): void {
  if (!Number.isFinite(spec.composition.width) || !Number.isFinite(spec.composition.height) ||
    spec.composition.width <= 0 || spec.composition.height <= 0 ||
    Math.abs(spec.composition.width / spec.composition.height - spec.composition.aspectRatio) > 1e-6) {
    throw new Error("raster_dimensions_invalid");
  }
  if (spec.evidenceClaimIds.length === 0 || spec.labels.some((label) => label.evidenceClaimIds.length === 0)) {
    throw new Error("raster_evidence_missing");
  }
  if (spec.styleLock.prohibitDecorativeClaims !== true) throw new Error("raster_style_lock_invalid");
}

function pngDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length < 24 || pngSignature.some((value, index) => bytes[index] !== value)) throw new Error("raster_png_invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    height: view.getUint32(20, false),
    width: view.getUint32(16, false)
  };
}
