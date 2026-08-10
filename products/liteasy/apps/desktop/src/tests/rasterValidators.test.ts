import { describe, expect, test } from "vitest";
import { sha256Hex, validateRasterImage } from "../app/features/visualization/validators/rasterValidators";
import type { RasterIllustrationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

function validPngBytes() {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
}

function svgWithExternalImage() {
  return new TextEncoder().encode('<svg><image href="https://example.com/x.png"/></svg>');
}

function rasterFixture(): RasterIllustrationSpecV1 {
  return {
    composition: { aspectRatio: 1, height: 2, width: 2 },
    evidenceClaimIds: ["claim-raster"],
    labels: [{ evidenceClaimIds: ["claim-raster"], id: "label-1", text: "cell" }],
    styleLock: { palette: ["#ffffff", "#111827"], prohibitDecorativeClaims: true, typography: "system" },
    visualSchema: "simple labelled diagram"
  };
}

describe("validateRasterImage", () => {
  test("accepts a digest-matched png with evidence-bound labels", async () => {
    const bytes = validPngBytes();

    await expect(validateRasterImage({ bytes, declaredSha256: await sha256Hex(bytes), spec: rasterFixture() })).resolves.toMatchObject({
      height: 2,
      mimeType: "image/png",
      width: 2
    });
  });

  test("rejects a raster with a mismatched digest or forbidden external reference", async () => {
    await expect(validateRasterImage({ bytes: validPngBytes(), declaredSha256: "wrong", spec: rasterFixture() })).rejects.toThrow("raster_digest_mismatch");
    await expect(validateRasterImage({ bytes: svgWithExternalImage(), declaredSha256: "", spec: rasterFixture() })).rejects.toThrow("raster_external_reference");
  });
});
