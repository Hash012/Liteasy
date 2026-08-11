import { describe, expect, test } from "vitest";
import { sha256Hex, validateRasterImage } from "../app/features/visualization/validators/rasterValidators";
import type { RasterIllustrationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

function validPngBytes() {
  return Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGP4DwUMMAYAj4IP8TylVlEAAAAASUVORK5CYII=", "base64"));
}

function svgWithExternalImage() {
  return new TextEncoder().encode('<svg><image href="https://example.com/x.png"/></svg>');
}

async function rasterFixture(bytes = validPngBytes()): Promise<RasterIllustrationSpecV1> {
  const sha256 = await sha256Hex(bytes);
  return {
    asset: {
      assetRef: `raster:${sha256}`,
      byteLength: bytes.byteLength,
      height: 2,
      labelVerification: { engine: "fixture-ocr/v1", verifiedLabelIds: ["label-1"] },
      mimeType: "image/png",
      sha256,
      width: 2
    },
    composition: { aspectRatio: 1, height: 2, width: 2 },
    evidenceClaimIds: ["claim-raster"],
    labels: [{ evidenceClaimIds: ["claim-raster"], id: "label-1", text: "cell" }],
    styleLock: { palette: ["#ffffff", "#111827"], prohibitDecorativeClaims: true, typography: "system" },
    visualSchema: "simple labelled diagram"
  };
}

describe("validateRasterImage", () => {
  test("accepts digest-matched, decoded PNG bytes with verified evidence labels", async () => {
    const bytes = validPngBytes();
    const spec = await rasterFixture(bytes);

    await expect(validateRasterImage({
      bytes,
      declaredSha256: spec.asset!.sha256,
      decode: async () => ({ hasTransparency: false, height: 2, width: 2 }),
      mimeType: "image/png",
      spec
    })).resolves.toMatchObject({ height: 2, mimeType: "image/png", width: 2 });
  });

  test("rejects digest, decode, OCR metadata, transparency and source identity failures", async () => {
    const bytes = validPngBytes();
    const spec = await rasterFixture(bytes);
    await expect(validateRasterImage({ bytes, declaredSha256: "wrong", decode: async () => ({ hasTransparency: false, height: 2, width: 2 }), spec })).rejects.toThrow("raster_digest_mismatch");
    await expect(validateRasterImage({ bytes, declaredSha256: spec.asset!.sha256, decode: async () => ({ hasTransparency: false, height: 3, width: 2 }), spec })).rejects.toThrow("raster_decode_dimensions_mismatch");
    await expect(validateRasterImage({ bytes, declaredSha256: spec.asset!.sha256, decode: async () => ({ hasTransparency: true, height: 2, width: 2 }), spec })).rejects.toThrow("raster_transparency_forbidden");
    await expect(validateRasterImage({ bytes, declaredSha256: spec.asset!.sha256, decode: async () => ({ hasTransparency: false, height: 2, width: 2 }), sourceIdentityHashes: [spec.asset!.sha256], spec })).rejects.toThrow("raster_source_identity_collision");
    await expect(validateRasterImage({ bytes, declaredSha256: spec.asset!.sha256, decode: async () => ({ hasTransparency: false, height: 2, width: 2 }), spec: { ...spec, asset: { ...spec.asset!, labelVerification: { ...spec.asset!.labelVerification, verifiedLabelIds: [] } } } })).rejects.toThrow("raster_ocr_label_mismatch");
    await expect(validateRasterImage({ bytes: svgWithExternalImage(), declaredSha256: "", spec })).rejects.toThrow("raster_external_reference");
  });
});
